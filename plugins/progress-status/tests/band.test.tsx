import { expect, test } from 'claude-code/testing'

const PLUGIN = 'progress-status'
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const usageAt = (tokens: number) => () => ({
  value: {
    startedAt: 0,
    context: { tokens, window: 200_000, percent: Math.round((tokens / 200_000) * 100) },
    rateLimits: [],
  },
})

// Beneath the plugin: what the engine draws when the plugin steps aside.
const engineBand = () => ($: any, e: any) => {
  const { Box } = $.ui.resolve(e)
  return <Box key="engine" />
}

test('desktop: segmented task bar, ring gauge and numbers', async ($, on) => {
  on('session.usage', usageAt(170_000))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Plan', status: 'completed', activeForm: 'Planning' },
      { content: 'Build', status: 'completed', activeForm: 'Building' },
      { content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' },
      { content: 'Ship', status: 'pending', activeForm: 'Shipping' },
    ],
  })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: '2/4' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Write tests' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '170k / 200k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '85%' })).toBeDefined()
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(2)
})

test('terminal: the band steps aside for the status line', async ($, on) => {
  on('session.usage', usageAt(170_000))
  on('tool.call', () => ({ result: {} }))
  on('ui.render', engineBand())
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Plan', status: 'pending', activeForm: 'Planning' }] })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /Context/ })).toBeUndefined()
})

test('desktop update_plan: items, then advance', async ($, on) => {
  on('session.usage', usageAt(20_000))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'First step', status: 'in_progress' },
      { content: 'Second step', status: 'pending' },
      { content: 'Third step', status: 'pending' },
    ],
  })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: '1/3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Second step' })).toBeDefined()
})

test('TaskCreate takes the id from the result; TaskUpdate completes it', async ($, on) => {
  on('session.usage', usageAt(20_000))
  let n = 0
  on('tool.call', ($, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: String(++n + 6), subject: 'x' } } } : { result: {} }))

  await $.tool.call({ tool: 'TaskCreate', subject: 'first', description: '' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'second', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: '1/2' })).toBeDefined()
})

test('nothing to show before any usage or tasks', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('ui.render', engineBand())
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /Context/ })).toBeUndefined()
})

test('no task list: counts steps live and names the running one', async ($, on) => {
  on('session.usage', usageAt(30_000))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }) as any)
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }) as any)

  await $.turn.start({ text: 'build it', turnId: 't1' } as any)
  await $.tool.call({ tool: 'Read', file_path: 'D:/app/src/pricing.js' } as any)
  await $.tool.call({ tool: 'Bash', command: 'npm test -- --watch=false', description: 'x' } as any)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: 'Steps' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '· Bash npm' })).toBeDefined()
  await ui.unmount()

  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1' } as any)
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await after.find({ type: 'Text', text: 'done' })).toBeDefined()
})

test('context refreshes after every model response', async ($, on) => {
  let tokens = 40_000
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200_000 }, rateLimits: [] } }))
  on('turn.step', async function* ($: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: {} } as any
  })

  tokens = 64_000
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as any)) { /* drain */ }
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: '64k / 200k' })).toBeDefined()
  await ui.unmount()

  tokens = 96_000
  for await (const _ of $.turn.step({ turnId: 't1', index: 1, model: 'm', messageCount: 3 } as any)) { /* drain */ }
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await again.find({ type: 'Text', text: '96k / 200k' })).toBeDefined()
})

test('desktop wrap-up checks off the whole list', async ($, on) => {
  on('session.usage', usageAt(20_000))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'Find the cause', status: 'completed' },
      { content: 'Fix it', status: 'completed' },
      { content: 'Test and push', status: 'in_progress' },
    ],
  })
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Done.' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: '3/3' })).toBeDefined()
})

test('a finished list stays next to the new request\'s steps', async ($, on) => {
  on('session.usage', usageAt(20_000))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }) as any)
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [1, 2, 3].map(i => ({ content: `Step ${i}`, status: 'completed' })),
  })
  await $.turn.start({ text: 'quick fix', turnId: 't2' } as any)
  await $.tool.call({ tool: 'Edit', file_path: 'D:/app/README.md', old_string: 'a', new_string: 'b' } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: '3/3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Steps' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '· Edit README.md' })).toBeDefined()
})

test('session start runs setup.js auto and says when it turned the status line on', async ($, on) => {
  const runs: string[][] = []
  const toasts: string[] = []
  on('session.usage', usageAt(10_000))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }) as any)
  on('process.run', ($: any, e: any) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: 'Installed. statusLine -> ...\ninstalled\n', stderr: '' } } as any
  })
  on('ui.toast', ($: any, e: any) => { toasts.push(e.text); return { value: undefined } as any })

  await $.session.start({ source: 'startup', cwd: 'D:/work' } as any)
  for (let i = 0; i < 20 && toasts.length === 0; i++) await new Promise(r => setTimeout(r, 5))

  expect(runs).toHaveLength(1)
  expect(runs[0]?.[0]).toBe('node')
  expect(runs[0]?.[1]).toMatch(/scripts\/setup\.js$/)
  expect(runs[0]?.[2]).toBe('auto')
  expect(toasts).toEqual(['progress-status: terminal status line turned on'])
})
