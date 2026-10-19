import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Task, TaskStatus, Usage } from '../types'

// Same idea as the terminal status line (plugins/progress-status/scripts/lib):
// tasks come from the task tools as they run, tokens from the live context window.

const tasksAtom = atom({ plugin: 'progress-status', key: 'tasks' } as const, [] as Task[])
const usageAtom = atom({ plugin: 'progress-status', key: 'usage' } as const, null as Usage | null)

const BAR_WIDTH = 10
const PLAN_TOOL = 'mcp__ccd_turn__update_plan'

function normStatus(s: unknown): TaskStatus | 'deleted' {
  const v = String(s ?? 'pending').toLowerCase()
  if (v === 'completed' || v === 'done' || v === 'complete') return 'completed'
  if (v === 'in_progress' || v === 'in-progress' || v === 'active') return 'in_progress'
  if (v === 'deleted' || v === 'removed' || v === 'cancelled') return 'deleted'
  return 'pending'
}

function fromList(items: unknown): Task[] | null {
  if (!Array.isArray(items)) return null
  return items.map((t, i) => {
    const o = (t ?? {}) as Record<string, unknown>
    const status = normStatus(o.status)
    return {
      id: String(i + 1),
      label: String(o.content ?? o.subject ?? ''),
      status: status === 'deleted' ? 'pending' : status,
    }
  })
}

// The desktop app's task list: a whole list, or advance / done / start by 1-based position.
function applyPlan(tasks: Task[], e: Record<string, unknown>): Task[] {
  const replaced = fromList(e.items)
  if (replaced) return replaced
  const next = tasks.map(t => ({ ...t }))
  if (e.advance === true) {
    const current = next.find(t => t.status === 'in_progress')
    if (current) current.status = 'completed'
    const pending = next.find(t => t.status === 'pending')
    if (pending) pending.status = 'in_progress'
  }
  if (Array.isArray(e.done)) {
    for (const n of e.done) if (next[Number(n) - 1]) next[Number(n) - 1].status = 'completed'
  }
  if (typeof e.start === 'number' && next[e.start - 1]) next[e.start - 1].status = 'in_progress'
  return next
}

function formatTokens(n: number): string {
  const trim = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, ''))
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`
  if (n >= 1_000) return `${trim(n / 1_000)}k`
  return String(Math.round(n))
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

function usageColor(ratio: number) {
  if (ratio > 0.8) return 'error' as const
  if (ratio >= 0.5) return 'warning' as const
  return 'success' as const
}

// Best-effort: a usage reading that fails must not lose a task update.
async function refreshUsage($: EngineInterface) {
  try {
    const { context } = await $.session.usage()
    const usage: Usage = { tokens: context.tokens ?? null, window: context.window }
    await update($, usageAtom, () => usage)
  } catch {
    // keep the last reading
  }
}

// Applies one finished task-tool call to the tracked list.
async function trackTasks($: EngineInterface, e: { tool: string }, ran: unknown) {
  const args = e as unknown as Record<string, unknown>
  if (e.tool === 'TodoWrite') {
    const list = fromList(args.todos)
    if (list) await update($, tasksAtom, () => list)
  } else if (e.tool === 'TaskCreate') {
    const created = (ran as { result?: { task?: { id?: string } } }).result?.task
    await update($, tasksAtom, tasks => [
      ...tasks,
      { id: String(created?.id ?? tasks.length + 1), label: String(args.subject ?? ''), status: 'pending' },
    ])
  } else if (e.tool === 'TaskUpdate') {
    const id = String(args.taskId)
    const status = args.status === undefined ? undefined : normStatus(args.status)
    await update($, tasksAtom, tasks =>
      status === 'deleted'
        ? tasks.filter(t => t.id !== id)
        : tasks.map(t => (t.id === id && status ? { ...t, status } : t)),
    )
  } else if (e.tool === PLAN_TOOL) {
    await update($, tasksAtom, tasks => applyPlan(tasks, args))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refreshUsage($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refreshUsage($)
    return result
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId || ran.deny !== undefined || ('isError' in ran && ran.isError)) return ran

    try {
      await trackTasks($, e, ran)
    } catch {
      // tracking is best-effort; the tool's result goes through untouched
    }
    await refreshUsage($)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const tasks = await read($, tasksAtom)
    const usage = await read($, usageAtom)
    if (tasks.length === 0 && (!usage || usage.tokens == null)) return next(e)

    const { Box, Text } = $.ui.resolve(e)

    const bar = (key: string, ratio: number, color: 'success' | 'warning' | 'error' | 'suggestion') => {
      const filled = Math.round(clamp01(ratio) * BAR_WIDTH)
      return [
        <Text key={`${key}-on`} mono color={color}>{'█'.repeat(filled)}</Text>,
        <Text key={`${key}-off`} mono dimColor>{'░'.repeat(BAR_WIDTH - filled)}</Text>,
      ]
    }

    const done = tasks.filter(t => t.status === 'completed').length
    const taskRatio = tasks.length ? done / tasks.length : 0
    const current = tasks.find(t => t.status === 'in_progress')

    const tokens = usage?.tokens ?? 0
    const window = usage?.window ?? 200_000
    const ctxRatio = tokens / window

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text key="tasks-label" dimColor>Tasks</Text>
        {tasks.length === 0 ? (
          <Text key="tasks-none" dimColor>—</Text>
        ) : (
          [
            ...bar('tasks', taskRatio, taskRatio >= 1 ? 'success' : 'suggestion'),
            <Text key="tasks-count" tabular>{`${done}/${tasks.length} ${Math.round(taskRatio * 100)}%`}</Text>,
          ]
        )}
        <Text key="sep" dimColor>│</Text>
        <Text key="ctx-label" dimColor>Context</Text>
        {bar('ctx', ctxRatio, usageColor(ctxRatio))}
        <Text key="ctx-count" tabular>{`${formatTokens(tokens)}/${formatTokens(window)}`}</Text>
        <Text key="ctx-pct" tabular color={usageColor(ctxRatio)}>{`${Math.round(clamp01(ctxRatio) * 100)}%`}</Text>
        {current ? <Text key="current" dimColor wrap="truncate">{`· ${current.label}`}</Text> : null}
      </Box>
    )
  })
}
