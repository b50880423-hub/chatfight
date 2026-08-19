const TRANSIENT_CODES = new Set([429, 502, 503, 504]);

function isTransientTelegramError(error) {
  const code = Number(error?.response?.error_code);
  const message = String(error?.message || '').toLowerCase();
  return TRANSIENT_CODES.has(code)
    || message.includes('econnreset')
    || message.includes('etimedout')
    || message.includes('socket hang up')
    || message.includes('network');
}

export async function retryTelegramCall(operation, { label = 'Telegram request', maxAttempts = 6 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientTelegramError(error) || attempt === maxAttempts) throw error;
      const retryAfter = Number(error?.response?.parameters?.retry_after);
      const delayMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(30_000, 2 ** (attempt - 1) * 1_000);
      const description = error?.response?.description || error?.message || 'temporary Telegram error';
      console.warn(
        '[Telegram] ' + label + ' failed (' + description + '). Retrying in '
        + Math.ceil(delayMs / 1000) + 's...'
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
