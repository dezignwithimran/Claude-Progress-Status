import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Task, TaskStatus, Usage } from '../types'

// Same idea as the terminal status line (plugins/progress-status/scripts/lib):
// tasks come from the task tools as they run, tokens from the live context window.
// Without a task list, the band counts the request's steps (tool calls) instead.

const tasksAtom = atom({ plugin: 'progress-status', key: 'tasks' } as const, [] as Task[])
const usageAtom = atom({ plugin: 'progress-status', key: 'usage' } as const, null as Usage | null)
const IDLE: Activity = { steps: 0, last: null, isWorking: false }
const activityAtom = atom({ plugin: 'progress-status', key: 'activity' } as const, IDLE)

// A short name for a step: "Edit pricing.js", "Bash npm", "Browser navigate".
function stepLabel(e: Record<string, unknown>): string {
  const tool = String(e.tool ?? '')
  const file = typeof e.file_path === 'string' ? e.file_path : typeof e.path === 'string' ? e.path : ''
  if (file) return `${tool} ${file.split(/[\\/]/).pop()}`
  if (typeof e.command === 'string') return `${tool} ${e.command.trim().split(/\s+/)[0] ?? ''}`.trim()
  if (tool.startsWith('mcp__')) {
    const [, server = '', name = ''] = tool.split('__')
    // Connector servers often have id-like names; the tool name alone reads better there.
    const isId = /^[0-9a-f-]{16,}$/i.test(server)
    return (isId ? name : `${server.replace(/^Claude_/, '')} ${name}`).replace(/_/g, ' ').trim()
  }
  return tool
}

const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
const WRAP_UP_TOOL = 'mcp__ccd_turn__wrap_up'

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

// Desktop drawings. The SVG is an image, so its colors are fixed values that read
// on both light and dark backgrounds; the track is a translucent grey.
const TASK_BAR_WIDTH = 132
const BAR_HEIGHT = 8
const RING_SIZE = 16
const FILL = { success: '#22c55e', warning: '#f59e0b', error: '#ef4444', progress: '#3b82f6' }
const TRACK = 'rgba(128,128,128,0.28)'

// One rounded pill per task (a single bar past 16 tasks): done filled,
// in progress half-filled, pending as track.
function taskBarSvg(tasks: Task[]): string {
  const allDone = tasks.every(t => t.status === 'completed')
  const color = allDone ? FILL.success : FILL.progress
  const w = TASK_BAR_WIDTH
  const h = BAR_HEIGHT
  const r = h / 2
  const rect = (x: number, width: number, rx: number, fill: string, opacity = 1) =>
    `<rect x="${x.toFixed(1)}" width="${width.toFixed(1)}" height="${h}" rx="${rx}" fill="${fill}"` +
    (opacity < 1 ? ` opacity="${opacity}"` : '') + '/>'

  let shapes = ''
  if (tasks.length > 16) {
    const done = tasks.filter(t => t.status === 'completed').length
    const fillW = done ? Math.max(h, (done / tasks.length) * w) : 0
    shapes = rect(0, w, r, TRACK) + (fillW ? rect(0, fillW, r, color) : '')
  } else {
    const gap = 3
    const segW = (w - gap * (tasks.length - 1)) / tasks.length
    const rx = Math.min(r, segW / 2)
    tasks.forEach((t, i) => {
      const x = i * (segW + gap)
      shapes += rect(x, segW, rx, t.status === 'completed' ? color : TRACK)
      if (t.status === 'in_progress') shapes += rect(x, segW / 2, rx, color, 0.6)
    })
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${shapes}</svg>`
}

// A ring gauge that fills clockwise from the top.
function ringSvg(ratio: number): string {
  const s = RING_SIZE
  const stroke = 3
  const rad = (s - stroke) / 2
  const c = 2 * Math.PI * rad
  const color = FILL[usageColor(ratio)]
  const arc = (clamp01(ratio) * c).toFixed(2)
  const mid = s / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">` +
    `<circle cx="${mid}" cy="${mid}" r="${rad}" fill="none" stroke="${TRACK}" stroke-width="${stroke}"/>` +
    (ratio > 0
      ? `<circle cx="${mid}" cy="${mid}" r="${rad}" fill="none" stroke="${color}" stroke-width="${stroke}" ` +
        `stroke-linecap="round" stroke-dasharray="${arc} ${c.toFixed(2)}" transform="rotate(-90 ${mid} ${mid})"/>`
      : '') +
    '</svg>'
  )
}

// Turns the terminal status line on without /progress-status:setup, and keeps its
// copied script current with the plugin. setup.js leaves alone a status line that
// isn't ours, and one the person turned off with /progress-status:remove.
async function autoSetup($: EngineInterface) {
  try {
    const script = `${$.plugin.root}/scripts/setup.js`.replace(/\\/g, '/')
    const { exitCode, stdout } = await $.process.run(['node', script, 'auto'], { timeoutMs: 15_000 })
    const outcome = stdout.trim().split(/\r?\n/).pop()
    if (exitCode === 0 && outcome === 'installed') {
      $.ui.toast('progress-status: terminal status line turned on')
    }
  } catch {
    // No Node on PATH, or settings.json unreadable: /progress-status:setup still works.
  }
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
  } else if (e.tool === WRAP_UP_TOOL) {
    // The desktop app's closing step checks off the whole list.
    await update($, tasksAtom, tasks => tasks.map(t => ({ ...t, status: 'completed' as const })))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refreshUsage($)
    void autoSetup($) // in the background: the session doesn't wait on it
    return result
  })

  // A new request starts its step count over.
  on('turn.start', async ($, e, next) => {
    // The task list stays until Claude makes a new one; only the step count starts over.
    await update($, activityAtom, () => ({ steps: 0, last: null, isWorking: true }))
    return next(e)
  })

  // Each model response: the context window has just grown, so read it again.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    await refreshUsage($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await update($, activityAtom, a => ({ ...a, isWorking: false }))
    await refreshUsage($)
    return result
  })

  on('tool.call', async ($, e, next) => {
    // Count the step as it starts, so the band names what is running now.
    if (!e.agentId) {
      const label = stepLabel(e as unknown as Record<string, unknown>)
      await update($, activityAtom, a => ({ steps: a.steps + 1, last: label, isWorking: true }))
    }
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
    // The terminal already has the status line; the band is for surfaces without one.
    if (e.surface === 'terminal' || e.props.hasSurvey) return next(e)
    const tasks = await read($, tasksAtom)
    const usage = await read($, usageAtom)
    const activity = await read($, activityAtom)
    if (tasks.length === 0 && activity.steps === 0 && (!usage || usage.tokens == null)) return next(e)

    const { Box, Text, Svg } = $.ui.resolve(e)

    const done = tasks.filter(t => t.status === 'completed').length
    const current = tasks.find(t => t.status === 'in_progress')
    const tokens = usage?.tokens ?? 0
    const window = usage?.window ?? 200_000
    const ratio = clamp01(tokens / window)
    const pct = Math.round(ratio * 100)

    return (
      <Box flexDirection="row" alignItems="center" columnGap={3} flexWrap="wrap">
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Text dimColor size="footnote">Tasks</Text>
          {tasks.length === 0 ? (
            <Text dimColor size="footnote">none yet</Text>
          ) : (
            [
              <Svg
                key="tasks-bar"
                source={taskBarSvg(tasks)}
                alt={`${done} of ${tasks.length} tasks done`}
                width={TASK_BAR_WIDTH}
                height={BAR_HEIGHT}
              />,
              <Text key="tasks-count" size="footnote" weight="medium" tabular>{`${done}/${tasks.length}`}</Text>,
            ]
          )}
          {current ? (
            <Text dimColor size="footnote" wrap="truncate">{current.label}</Text>
          ) : null}
        </Box>
        {activity.steps > 0 ? (
          <Box flexDirection="row" alignItems="center" columnGap={1}>
            <Text dimColor size="footnote">Steps</Text>
            <Text size="footnote" weight="medium" tabular>{String(activity.steps)}</Text>
            {activity.isWorking && activity.last ? (
              <Text dimColor size="footnote" wrap="truncate">{`· ${activity.last}`}</Text>
            ) : (
              <Text size="footnote" color="success">done</Text>
            )}
          </Box>
        ) : null}
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Svg source={ringSvg(ratio)} alt={`Context ${pct}% full`} width={RING_SIZE} height={RING_SIZE} />
          <Text dimColor size="footnote">Context</Text>
          <Text size="footnote" weight="medium" tabular>{`${formatTokens(tokens)} / ${formatTokens(window)}`}</Text>
          <Text size="footnote" weight="semibold" tabular color={usageColor(ratio)}>{`${pct}%`}</Text>
        </Box>
      </Box>
    )
  })
}
