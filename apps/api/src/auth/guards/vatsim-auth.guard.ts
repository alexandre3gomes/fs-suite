import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';

@Injectable()
export class VatsimAuthGuard extends AuthGuard('vatsim') {
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
