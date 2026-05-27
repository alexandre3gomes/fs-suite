import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Response } from 'express';

import { UpstreamUnavailableException } from '../exceptions/upstream-unavailable.exception';

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentryExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (exception instanceof UpstreamUnavailableException) {
      // External provider unreachable (DECEA, AVWX, OWM, etc). Per-request
      // flakiness isn't a server bug — uptime of those providers is tracked
      // by external monitoring (UptimeRobot, status pages), not by our
      // error-rate. Log + respond; don't alert.
      this.logger.warn(`Upstream unavailable: ${exception.upstream}`);
    } else if (status >= 500 || !isHttpException) {
      // Only report server errors (5xx) and unexpected exceptions to Sentry.
      // 4xx errors are client mistakes and don't need alerting.
      Sentry.captureException(exception);
    }

    const body = isHttpException
      ? exception.getResponse()
      : { statusCode: status, message: 'Internal server error' };

    response.status(status).json(body);
  }
}
