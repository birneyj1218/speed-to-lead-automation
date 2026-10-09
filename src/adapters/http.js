/** Small fetch helpers with timeout and retry on network errors, 429 and 5xx. */

export class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}: ${String(body).slice(0, 200)}`);
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withRetry(fn, { tries = 3, baseDelayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const retryable = err.retryable !== false;
      if (!retryable || attempt === tries) break;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

export async function request(url, { method = 'POST', headers = {}, body, timeoutMs = 10000, tries = 3, baseDelayMs = 500 } = {}) {
  return withRetry(
    async () => {
      const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, text);
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    },
    { tries, baseDelayMs },
  );
}
