#!/usr/bin/env node
'use strict';

// Claude Code status line: model │ task progress bar │ context-window token bar.
// Reads the session JSON from stdin and prints one line.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { renderBar, paint, usageColor, progressColor, formatTokens, percent } = require('./lib/bar');
const { contextTokens } = require('./lib/tokens');
const { scanTranscript, taskProgress } = require('./lib/tasks');

const DEFAULTS = {
  barWidth: 10,
  colors: true,
  showModel: true,
  showTasks: true,
  showCurrentTask: false,
  showContext: true,
  separator: ' │ ',
  demo: false,
};

function loadConfig() {
  const file =
    process.env.PROGRESS_STATUS_CONFIG ||
    path.join(os.homedir(), '.claude', 'progress-status', 'config.json');
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // no config is fine
  }
  const cfg = { ...DEFAULTS, ...user };
  if (process.env.NO_COLOR) cfg.colors = false;
  if (process.env.PROGRESS_STATUS_DEMO === '1') cfg.demo = true;
  return cfg;
}

function cacheFile(transcriptPath) {
  const key = crypto.createHash('sha1').update(transcriptPath).digest('hex').slice(0, 16);
  const dir = process.env.PROGRESS_STATUS_CACHE_DIR || path.join(os.tmpdir(), 'claude-progress-status');
  return { dir, file: path.join(dir, `${key}.json`) };
}

function readState(transcriptPath) {
  if (!transcriptPath) return null;
  const { dir, file } = cacheFile(transcriptPath);
  let prev = null;
  try {
    prev = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // first run for this session
  }
  const state = scanTranscript(transcriptPath, prev);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    // caching is best-effort
  }
  return state;
}

// Demo mode: each refresh steps through sample values so every color can be
// seen in the real status line without waiting for a long session.
const DEMO_STAGES = [
  { done: 1, total: 4, used: 50_000 },
  { done: 2, total: 4, used: 120_000 },
  { done: 3, total: 4, used: 170_000 },
  { done: 4, total: 4, used: 190_000 },
];

function demoState(input) {
  const dir = process.env.PROGRESS_STATUS_CACHE_DIR || path.join(os.tmpdir(), 'claude-progress-status');
  const file = path.join(dir, 'demo-step');
  let step = 0;
  try {
    step = (parseInt(fs.readFileSync(file, 'utf8'), 10) || 0) % DEMO_STAGES.length;
  } catch {
    // start at the first stage
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, String(step + 1));
  } catch {
    // best-effort
  }
  const s = DEMO_STAGES[step];
  const tasks = Array.from({ length: s.total }, (_, i) => ({
    id: String(i + 1),
    status: i < s.done ? 'completed' : i === s.done ? 'in_progress' : 'pending',
    label: `Demo step ${i + 1}`,
  }));
  return {
    input: {
      ...input,
      context_window: { context_window_size: 200_000, current_usage: { input_tokens: s.used } },
    },
    state: { tasks, lastUsage: null },
  };
}

function render(input, cfg) {
  const c = cfg.colors;
  const parts = [];
  let state;
  if (cfg.demo) ({ input, state } = demoState(input));
  else state = readState(input.transcript_path);

  if (cfg.demo) parts.push(paint('DEMO', 'yellow', c));

  if (cfg.showModel) {
    const model = (input.model && (input.model.display_name || input.model.id)) || 'Claude';
    parts.push(paint(model, 'bold', c));
  }

  if (cfg.showTasks) {
    const { done, total, current } = taskProgress(state);
    if (total === 0) {
      parts.push(`Tasks ${paint('—', 'dim', c)}`);
    } else {
      const ratio = done / total;
      const bar = renderBar(ratio, { width: cfg.barWidth, color: progressColor(ratio), useColor: c });
      let seg = `Tasks ${bar} ${done}/${total} ${percent(ratio)}`;
      if (cfg.showCurrentTask && current) seg += ` ${paint('· ' + current, 'dim', c)}`;
      parts.push(seg);
    }
  }

  if (cfg.showContext) {
    const { used, limit } = contextTokens(input, state && state.lastUsage);
    if (used == null) {
      parts.push(`Context ${renderBar(0, { width: cfg.barWidth, useColor: c })} 0/${formatTokens(limit)}`);
    } else {
      const ratio = used / limit;
      const bar = renderBar(ratio, { width: cfg.barWidth, color: usageColor(ratio), useColor: c });
      const pct = paint(percent(ratio), usageColor(ratio), c);
      parts.push(`Context ${bar} ${formatTokens(used)}/${formatTokens(limit)} ${pct}`);
    }
  }

  return parts.join(paint(cfg.separator, 'dim', c));
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    let input = {};
    try {
      input = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      // keep going with an empty input
    }
    try {
      process.stdout.write(render(input, loadConfig()));
    } catch (err) {
      // Never break the status line: fall back to something plain.
      const model = (input.model && input.model.display_name) || 'Claude';
      process.stdout.write(`${model} │ progress-status error: ${err.message}`);
    }
  });
}

if (require.main === module) main();

module.exports = { render, DEFAULTS };
