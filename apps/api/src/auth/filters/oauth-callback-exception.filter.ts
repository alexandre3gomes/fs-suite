import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

/**
 * Catches errors from the OAuth callback flow — most commonly the
 * `TokenError: Malformed auth code` that passport-oauth2 raises when
 * Google rejects a code (back-button refresh on the callback URL,
 * double-clicks on the sign-in button, bot scanners). These are user
 * or transport-level failures, not server bugs.
 *
 * Behaviour:
 *   - logs at `warn` (so they're searchable but not paged on)
 *   - redirects the user back to the app `/auth/callback?error=...`
 *     (the frontend treats `?error=` the same as no code: bounce to
 *     `/login` for retry)
 *   - **does NOT report to Sentry** — otherwise every browser back
 *     button and every fuzzing bot pollutes the error stream and
 *     buries real issues
 */
@Catch()
export class OAuthCallbackExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(OAuthCallbackExceptionFilter.name);

  constructor(private readonly config: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const cookies = (request.cookies ?? {}) as Record<string, string>;
    const platform = cookies['oauth_platform'] ?? 'web';
    response.clearCookie('oauth_platform');

    const name = (exception as { name?: string })?.name ?? 'Error';
    const message = (exception as { message?: string })?.message ?? '';
    this.logger.warn(`OAuth callback failed: ${name} — ${message}`);

    if (platform === 'native') {
      response.redirect('fssuite://auth/callback?error=oauth_failed');
      return;
    }

    const webOrigin = this.config.get<string>('WEB_ORIGIN', 'http://localhost:8081');
    response.redirect(`${webOrigin}/auth/callback?error=oauth_failed`);
  }
}
