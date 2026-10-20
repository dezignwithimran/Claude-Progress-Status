'use strict';

// Reads a Claude Code transcript (JSONL) incrementally and tracks:
//   - the current task list (TodoWrite, or TaskCreate/TaskUpdate)
//   - the usage block of the latest main-thread assistant message
// State is plain JSON so it can be cached between status line runs.

const fs = require('fs');

function emptyState() {
  return { offset: 0, size: 0, tasks: [], nextId: 1, pending: {}, lastUsage: null };
}

function normStatus(s) {
  const v = String(s || 'pending').toLowerCase();
  if (v === 'done' || v === 'complete' || v === 'completed') return 'completed';
  if (v === 'in_progress' || v === 'in-progress' || v === 'active') return 'in_progress';
  if (v === 'deleted' || v === 'removed' || v === 'cancelled') return 'deleted';
  return 'pending';
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function taskLabel(t) {
  return String(t.content || t.subject || t.title || t.description || '').slice(0, 80);
}

function addTask(state, t, toolUseId) {
  const id = t.id != null ? String(t.id) : String(state.nextId);
  state.nextId = Math.max(state.nextId, (parseInt(id, 10) || state.nextId)) + 1;
  state.tasks.push({ id, status: normStatus(t.status), label: taskLabel(t) });
  if (toolUseId) state.pending[toolUseId] = state.tasks.length - 1;
}

function applyToolUse(state, block) {
  const name = String(block.name || '');
  const input = block.input || {};

  // TodoWrite, and the plugin's own task-list tool, send the whole list each time.
  if (name === 'TodoWrite' || name === 'mcp__progress-status__tasks') {
    const todos = asArray(name === 'TodoWrite' ? input.todos : input.items);
    if (!todos) return;
    state.tasks = [];
    state.nextId = 1;
    todos.forEach((t) => addTask(state, t));
    return;
  }

  if (name === 'TaskCreate') {
    const many = asArray(input.tasks);
    if (many) many.forEach((t) => addTask(state, t));
    else addTask(state, input, block.id);
    return;
  }

  if (name === 'TaskUpdate') {
    const id = input.taskId != null ? input.taskId : input.id;
    if (id == null) return;
    const task = state.tasks.find((t) => t.id === String(id));
    if (!task) return;
    if (input.status) task.status = normStatus(input.status);
    if (task.status === 'deleted') state.tasks = state.tasks.filter((t) => t !== task);
  }
}

// When the tool result tells us the real id of a created task, adopt it.
function applyToolResult(state, block, toolUseResult) {
  const idx = state.pending[block.tool_use_id];
  if (idx == null) return;
  delete state.pending[block.tool_use_id];
  const task = state.tasks[idx];
  if (!task) return;

  let realId = null;
  const tur = toolUseResult || {};
  if (tur.task && tur.task.id != null) realId = tur.task.id;
  else if (tur.taskId != null) realId = tur.taskId;
  else {
    const text = typeof block.content === 'string'
      ? block.content
      : Array.isArray(block.content)
        ? block.content.map((c) => c.text || '').join(' ')
        : '';
    const m = text.match(/task\s*#?\s*(\d+)/i);
    if (m) realId = m[1];
  }
  if (realId != null) task.id = String(realId);
}

function applyLine(state, line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }
  if (!entry || entry.isSidechain) return;
  const msg = entry.message;
  if (!msg || !Array.isArray(msg.content)) {
    if (msg && msg.role === 'assistant' && msg.usage) state.lastUsage = msg.usage;
    return;
  }

  if (msg.role === 'assistant' && msg.usage) state.lastUsage = msg.usage;

  for (const block of msg.content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'tool_use') applyToolUse(state, block);
    else if (block.type === 'tool_result') applyToolResult(state, block, entry.toolUseResult);
  }
}

/**
 * Bring `state` up to date with the transcript file, reading only bytes
 * added since the last call. Returns the (possibly reset) state.
 */
function scanTranscript(path, state) {
  let s = state && typeof state.offset === 'number' ? state : emptyState();
  let stat;
  try {
    stat = fs.statSync(path);
  } catch {
    return s;
  }
  if (stat.size < s.offset) s = emptyState(); // file was rewritten
  if (stat.size === s.offset) return s;

  const fd = fs.openSync(path, 'r');
  try {
    const length = stat.size - s.offset;
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, s.offset);
    // Only consume up to the last complete line; a partial line is re-read next time.
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl === -1) return s;
    const text = buf.subarray(0, lastNl).toString('utf8');
    for (const line of text.split('\n')) {
      if (line.trim()) applyLine(s, line);
    }
    s.offset += lastNl + 1;
    s.size = stat.size;
  } finally {
    fs.closeSync(fd);
  }
  return s;
}

function taskProgress(state) {
  const tasks = (state && state.tasks) || [];
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'completed').length;
  const current = tasks.find((t) => t.status === 'in_progress');
  return { done, total, current: current ? current.label : null };
}

module.exports = { scanTranscript, taskProgress, emptyState };
