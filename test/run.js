'use strict';

// Run with: node test/run.js
// Builds sample transcripts in a temp dir, pipes sample stdin through the
// status line script, and checks the output. Also exercises setup.js
// against a throwaway CLAUDE_CONFIG_DIR.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'plugins', 'progress-status', 'scripts');
const STATUSLINE = path.join(SCRIPTS, 'statusline.js');
const SETUP = path.join(SCRIPTS, 'setup.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-status-test-'));
const env = {
  ...process.env,
  NO_COLOR: '1',
  PROGRESS_STATUS_CACHE_DIR: path.join(tmp, 'cache'),
  PROGRESS_STATUS_CONFIG: path.join(tmp, 'no-config.json'),
};

const assistant = (content, usage) =>
  JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content, usage } });
const user = (content, toolUseResult) =>
  JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content }, toolUseResult });
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });
const usage = (n) => ({ input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: n - 2, output_tokens: 50 });

function transcript(name, lines) {
  const file = path.join(tmp, `${name}.jsonl`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

function run(input) {
  return execFileSync('node', [STATUSLINE], { input: JSON.stringify(input), env }).toString();
}

const model = { id: 'claude-opus-5-5', display_name: 'Opus 5.5' };
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (err) {
    console.log(`FAIL ${name}\n     ${err.message}`);
    process.exitCode = 1;
  }
}

test('no tasks, context from stdin', () => {
  const t = transcript('empty', [assistant([{ type: 'text', text: 'hi' }], usage(1000))]);
  const out = run({
    model,
    transcript_path: t,
    context_window: {
      context_window_size: 200000,
      current_usage: { input_tokens: 4000, cache_creation_input_tokens: 0, cache_read_input_tokens: 80200 },
    },
  });
  assert.match(out, /Opus 5\.5/);
  assert.match(out, /Tasks —/);
  assert.match(out, /Context ████░░░░░░ 84\.2k\/200k 42%/);
});

test('TodoWrite partial progress', () => {
  const todos = ['a', 'b', 'c', 'd', 'e'].map((c, i) => ({ content: c, status: i < 3 ? 'completed' : i === 3 ? 'in_progress' : 'pending' }));
  const t = transcript('todo', [assistant([toolUse('t1', 'TodoWrite', { todos })], usage(5000))]);
  const out = run({ model, transcript_path: t });
  assert.match(out, /Tasks ██████░░░░ 3\/5 60%/);
});

test('TaskCreate (stringified list) + TaskUpdate to all done', () => {
  const list = JSON.stringify([{ content: 'x', status: 'in_progress' }, { content: 'y', status: 'pending' }]);
  const t = transcript('tasks', [
    assistant([toolUse('c1', 'TaskCreate', { tasks: list })], usage(1000)),
    assistant([toolUse('u1', 'TaskUpdate', { taskId: '1', status: 'completed' })], usage(1000)),
    assistant([toolUse('u2', 'TaskUpdate', { taskId: '2', status: 'completed' })], usage(1000)),
  ]);
  assert.match(run({ model, transcript_path: t }), /Tasks ██████████ 2\/2 100%/);
});

test('single TaskCreate uses id from tool result', () => {
  const t = transcript('single', [
    assistant([toolUse('c1', 'TaskCreate', { subject: 'first' })], usage(1000)),
    user([{ type: 'tool_result', tool_use_id: 'c1', content: 'Task #7 created successfully' }]),
    assistant([toolUse('c2', 'TaskCreate', { subject: 'second' })], usage(1000)),
    assistant([toolUse('u1', 'TaskUpdate', { taskId: '7', status: 'completed' })], usage(1000)),
  ]);
  assert.match(run({ model, transcript_path: t }), /1\/2 50%/);
});

test('incremental read picks up appended lines', () => {
  const file = transcript('grow', [
    assistant([toolUse('t1', 'TodoWrite', { todos: [{ content: 'a', status: 'pending' }, { content: 'b', status: 'pending' }] })], usage(1000)),
  ]);
  assert.match(run({ model, transcript_path: file }), /0\/2 0%/);
  fs.appendFileSync(file, assistant([toolUse('t2', 'TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] })], usage(1000)) + '\n');
  assert.match(run({ model, transcript_path: file }), /1\/2 50%/);
});

test('missing context_window falls back to transcript usage', () => {
  const t = transcript('fallback', [assistant([{ type: 'text', text: 'x' }], usage(190000))]);
  const out = run({ model, transcript_path: t });
  assert.match(out, /190k\/200k 95%/);
});

test('1M model limit guess', () => {
  const t = transcript('big', [assistant([{ type: 'text', text: 'x' }], usage(250000))]);
  const out = run({ model: { id: 'claude-opus-5-5[1m]', display_name: 'Opus 5.5 (1M context)' }, transcript_path: t });
  assert.match(out, /250k\/1M 25%/);
});

test('usage above 200k bumps the guessed limit to 1M', () => {
  const t = transcript('over', [assistant([{ type: 'text', text: 'x' }], usage(320000))]);
  assert.match(run({ model, transcript_path: t }), /320k\/1M 32%/);
});

test('demo mode cycles through all four stages', () => {
  const e = { ...env, PROGRESS_STATUS_DEMO: '1' };
  const outs = [1, 2, 3, 4, 5].map(() =>
    execFileSync('node', [STATUSLINE], { input: JSON.stringify({ model }), env: e }).toString()
  );
  assert.match(outs[0], /^DEMO .*1\/4 25% .*50k\/200k 25%/);
  assert.match(outs[1], /2\/4 50% .*120k\/200k 60%/);
  assert.match(outs[2], /3\/4 75% .*170k\/200k 85%/);
  assert.match(outs[3], /4\/4 100% .*190k\/200k 95%/);
  assert.match(outs[4], /1\/4 25%/); // wraps around
});

test('garbage stdin still prints a line', () => {
  const out = execFileSync('node', [STATUSLINE], { input: 'not json', env }).toString();
  assert.match(out, /Claude/);
});

test('setup install / uninstall round trip', () => {
  const cfgDir = path.join(tmp, 'claude-home');
  fs.mkdirSync(cfgDir);
  const settingsFile = path.join(cfgDir, 'settings.json');
  const original = { theme: 'dark', statusLine: { type: 'command', command: 'echo old' } };
  fs.writeFileSync(settingsFile, JSON.stringify(original));
  const e = { ...env, CLAUDE_CONFIG_DIR: cfgDir };

  execFileSync('node', [SETUP, 'install'], { env: e });
  const installed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.match(installed.statusLine.command, /progress-status\/statusline\.js/);
  assert.strictEqual(installed.theme, 'dark');
  assert.ok(fs.existsSync(path.join(cfgDir, 'progress-status', 'lib', 'tasks.js')));

  // The installed copy must run on its own.
  const t = transcript('installed', [assistant([{ type: 'text', text: 'x' }], usage(1000))]);
  const out = execFileSync('node', [path.join(cfgDir, 'progress-status', 'statusline.js')], {
    input: JSON.stringify({ model, transcript_path: t }), env,
  }).toString();
  assert.match(out, /Context/);

  const cfgFile = path.join(cfgDir, 'progress-status', 'config.json');
  execFileSync('node', [SETUP, 'demo', 'on'], { env: e });
  assert.strictEqual(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).demo, true);
  execFileSync('node', [SETUP, 'demo'], { env: e }); // toggles off
  assert.strictEqual(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).demo, false);

  execFileSync('node', [SETUP, 'uninstall'], { env: e });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), original);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed`);
