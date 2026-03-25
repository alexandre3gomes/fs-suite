import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import type { Request } from 'express';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  override canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const platform = (request.query['platform'] as string) ?? 'web';
    response.cookie('oauth_platform', platform, {
      httpOnly: true,
      maxAge: 300_000,
      sameSite: 'lax',
    });

    return super.canActivate(context) as boolean | Promise<boolean>;
  }
}
