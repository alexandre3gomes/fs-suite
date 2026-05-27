import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Thrown when an upstream provider we depend on is transiently
 * unreachable: DNS resolution failure (EAI_AGAIN, ENOTFOUND),
 * connection refused/reset (ECONNREFUSED, ECONNRESET), network
 * unreachable (ENETUNREACH, EHOSTUNREACH), or request timeout.
 *
 * Producing this rather than a generic 500 has two purposes:
 *   - The client gets a semantically accurate 502 Bad Gateway
 *     ("we're up; the thing we depend on isn't"), enabling
 *     retry/cache strategies on the caller side.
 *   - `SentryExceptionFilter` recognises this class and skips
 *     `captureException`. Per-request external flakiness is not a
 *     server bug; sustained outages are caught by external uptime
 *     monitoring (UptimeRobot), not by error-rate alerts.
 */
export class UpstreamUnavailableException extends HttpException {
  constructor(
    public readonly upstream: string,
    cause?: unknown,
  ) {
    super(
      {
        statusCode: HttpStatus.BAD_GATEWAY,
        message: `Upstream service unavailable: ${upstream}`,
        upstream,
      },
      HttpStatus.BAD_GATEWAY,
    );
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Recognises the Node.js error shapes for transient network/DNS
 * failures that should be reported as 502 rather than 500.
 *
 * Native `fetch` (undici under the hood) typically throws a
 * `TypeError` with a `cause` whose `code` is the underlying syscall
 * error code. `AbortError` is what `AbortSignal.timeout(...)` raises.
 */
export function isTransientNetworkError(err: unknown): boolean {
  const TRANSIENT_CODES = new Set([
    'EAI_AGAIN', // DNS temporary failure
    'ENOTFOUND', // DNS no such host (often transient on flaky resolvers)
    'ECONNREFUSED',
    'ECONNRESET',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
  ]);

  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  if (err.message.toLowerCase().includes('fetch failed')) {
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code && TRANSIENT_CODES.has(cause.code)) return true;
  }
  const code = (err as { code?: string }).code;
  if (code && TRANSIENT_CODES.has(code)) return true;
  return false;
}
