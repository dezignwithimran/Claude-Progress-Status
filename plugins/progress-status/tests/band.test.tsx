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
