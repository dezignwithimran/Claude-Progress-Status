import { expect, test } from 'claude-code/testing'

const PLUGIN = 'progress-status'
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const usageAt = (tokens: number) => () => ({ value: {
  startedAt: 0,
  context: { tokens, window: 200_000, percent: Math.round((tokens / 200_000) * 100) },
  rateLimits: [],
} })

test('TodoWrite progress and context tokens show on every surface', async ($, on) => {
  on('session.usage', usageAt(170_000))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'a', status: 'completed', activeForm: 'a' },
      { content: 'b', status: 'completed', activeForm: 'b' },
      { content: 'c', status: 'in_progress', activeForm: 'c' },
      { content: 'd', status: 'pending', activeForm: 'd' },
    ],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: '2/4 50%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '170k/200k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '85%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '· c' })).toBeDefined()
    await ui.unmount()
  }
})

test('desktop update_plan: items, then advance', async ($, on) => {
  on('session.usage', usageAt(20_000))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'one', status: 'in_progress' },
      { content: 'two', status: 'pending' },
      { content: 'three', status: 'pending' },
    ],
  })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: '1/3 33%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '· two' })).toBeDefined()
})

test('TaskCreate takes the id from the result; TaskUpdate completes it', async ($, on) => {
  on('session.usage', usageAt(20_000))
  let n = 0
  on('tool.call', ($, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: String(++n + 6), subject: 'x' } } } : { result: {} }))

  await $.tool.call({ tool: 'TaskCreate', subject: 'first', description: '' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'second', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: '1/2 50%' })).toBeDefined()
})

test('nothing to show before any usage or tasks', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /Context/ })).toBeUndefined()
})
