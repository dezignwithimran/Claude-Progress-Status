'use strict';

const DEFAULT_LIMIT = 200_000;
const LARGE_LIMIT = 1_000_000;

function num(v) {
  return Number.isFinite(v) ? v : 0;
}

// Tokens that occupy the context window for one request.
function sumUsage(u) {
  if (!u || typeof u !== 'object') return null;
  const total =
    num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens);
  return total > 0 ? total : null;
}

function guessLimit(model) {
  const id = String((model && model.id) || '');
  const name = String((model && model.display_name) || '');
  if (/\[1m\]/i.test(id) || /1m/i.test(name)) return LARGE_LIMIT;
  return DEFAULT_LIMIT;
}

/**
 * Work out { used, limit } from the status line stdin, falling back to the
 * last assistant usage seen in the transcript.
 */
function contextTokens(input, lastUsage) {
  const cw = input && input.context_window;
  let limit = cw && Number.isFinite(cw.context_window_size) ? cw.context_window_size : null;
  let used = null;

  if (cw) {
    used = sumUsage(cw.current_usage);
    if (used == null && Number.isFinite(cw.used_percentage) && limit) {
      used = Math.round((cw.used_percentage / 100) * limit);
    }
  }
  if (used == null) used = sumUsage(lastUsage);
  if (!limit) {
    limit = guessLimit(input && input.model);
    // Usage past the guessed limit means the model has the larger window.
    if (used != null && used > limit) limit = LARGE_LIMIT;
  }

  return { used, limit };
}

module.exports = { contextTokens, sumUsage, guessLimit };
