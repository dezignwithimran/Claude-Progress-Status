'use strict';

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function paint(text, color, useColor) {
  if (!useColor || !color) return text;
  return `${ANSI[color]}${text}${ANSI.reset}`;
}

// Green < 50%, yellow 50–80%, red > 80%. Used for "how full" meters like context.
function usageColor(ratio) {
  if (ratio > 0.8) return 'red';
  if (ratio >= 0.5) return 'yellow';
  return 'green';
}

// Progress toward a goal: done is good, so it never goes red.
function progressColor(ratio) {
  if (ratio >= 1) return 'green';
  return 'cyan';
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function renderBar(ratio, { width = 10, color, useColor = true } = {}) {
  const r = clamp01(ratio);
  const filled = Math.round(r * width);
  const full = '█'.repeat(filled);
  const empty = '░'.repeat(width - filled);
  return paint(full, color, useColor) + paint(empty, 'dim', useColor);
}

function formatTokens(n) {
  if (!Number.isFinite(n)) return '?';
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}k`;
  return String(Math.round(n));
}

function trim(x) {
  return x >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, '');
}

function percent(ratio) {
  return `${Math.round(clamp01(ratio) * 100)}%`;
}

module.exports = { ANSI, paint, usageColor, progressColor, renderBar, formatTokens, percent };
