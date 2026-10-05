// Connects the simulation to Claude through the artifact's `sample` capability
// (billed to the viewer's own Claude plan). Errors are sorted into what the
// runner should do: skip a turn, pause for the viewer, or stop.

const SKIP = new Set(['refused', 'invalid_json', 'empty_completion', 'prompt_too_large', 'invalid_request', 'transform_error']);
const PAUSE = new Set(['rate_limited', 'upstream_error', 'session_expired', 'queue_overflow']);

export const ERROR_COPY = {
  refused: 'Claude declined to write this turn.',
  invalid_json: 'The reply could not be read.',
  empty_completion: 'The reply was empty.',
  prompt_too_large: 'The prompt was too large.',
  rate_limited: 'Claude usage limit reached. Wait a while, then continue.',
  upstream_error: 'Claude did not respond. Try continuing.',
  session_expired: 'Your session expired. Sign in again, then continue.',
  not_granted: 'This page is not allowed to use Claude. Allow it from the page\'s permissions to run the simulation.',
  sampling_disabled: 'Claude is not available for this account.',
  cancelled: 'Stopped.',
};

function classify(e) {
  const code = (e && e.code) || 'upstream_error';
  if (code === 'cancelled') return { kind: 'pause', code, message: ERROR_COPY.cancelled };
  if (SKIP.has(code)) return { kind: 'skip', code, message: ERROR_COPY[code] || code, text: e.text };
  if (PAUSE.has(code)) return { kind: 'pause', code, message: ERROR_COPY[code] || code };
  return { kind: 'fatal', code, message: ERROR_COPY[code] || 'Claude is not available to this page.' };
}

export function sampleAI(sample, { signal } = {}) {
  const call = async (prompt, tier) => {
    try {
      const opts = { modelTier: tier || 'default', cache: false };
      const sig = signal?.();
      if (sig) opts.signal = sig;
      return await sample.json(prompt, opts);
    } catch (e) {
      throw classify(e);
    }
  };
  return {
    agent: (prompt, { tier } = {}) => call(prompt, tier),
    referee: (prompt, { tier } = {}) => call(prompt, tier),
  };
}
