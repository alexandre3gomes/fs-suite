import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { User } from '@prisma/client';
import type { Request, Response } from 'express';

import { Public } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

import { AuthService } from './auth.service';
import { OAuthCallbackExceptionFilter } from './filters/oauth-callback-exception.filter';
import { GoogleAuthGuard } from './guards/google-auth.guard';

const REFRESH_COOKIE = 'refresh_token';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

@ApiTags('auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'List enabled OAuth providers' })
  getProviders(): { providers: string[] } {
    const providers = ['google'];
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      providers.push('dev');
    }
    return { providers };
  }

  @Public()
  @Get('dev-login')
  @ApiOperation({ summary: 'Dev-only login bypass — creates session for first user' })
  async devLogin(
    @Query('platform') platform: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      res.status(404).json({ message: 'Not found' });
      return;
    }

    const user = await this.prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!user) {
      res.status(400).json({ message: 'No users in database — sign in with OAuth first' });
      return;
    }

    const tokens = await this.authService.createSession(user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    const code = await this.authService.storeAuthCode(tokens);

    if (platform === 'native') {
      res.redirect(`fssuite://auth/callback?code=${encodeURIComponent(code)}`);
      return;
    }

    const callbackUrl = `${this.authService.getWebOrigin()}/auth/callback?code=${encodeURIComponent(code)}`;
    res.redirect(callbackUrl);
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Redirect to Google OAuth consent screen' })
  googleAuth(): void {
    // Passport handles the redirect — body never reached
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @UseFilters(OAuthCallbackExceptionFilter)
  @ApiOperation({ summary: 'Google OAuth callback — issues auth code and redirects to app' })
  async googleCallback(
    @Req() req: Request & { user: User },
    @Res() res: Response,
  ): Promise<void> {
    const platform: string = (req.cookies as Record<string, string>)['oauth_platform'] ?? 'web';
    res.clearCookie('oauth_platform');

    const tokens = await this.authService.createSession(req.user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    const code = await this.authService.storeAuthCode(tokens);

    if (platform === 'native') {
      res.redirect(`fssuite://auth/callback?code=${encodeURIComponent(code)}`);
      return;
    }

    const callbackUrl = `${this.authService.getWebOrigin()}/auth/callback?code=${encodeURIComponent(code)}`;
    res.redirect(callbackUrl);
  }

  @Public()
  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange one-time auth code for tokens' })
  async exchange(
    @Body() body: { code: string; platform?: string },
    @Res() res: Response,
  ): Promise<void> {
    const { accessToken, refreshToken } = await this.authService.exchangeAuthCode(body.code);

    if (body.platform === 'native') {
      res.json({ accessToken, refreshToken });
      return;
    }

    const isProduction = process.env['NODE_ENV'] === 'production';
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
    });
    res.json({ accessToken });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate access and refresh tokens' })
  async refresh(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cookieToken = (req.cookies as Record<string, string>)[REFRESH_COOKIE];
    const bodyToken = (req.body as { refreshToken?: string }).refreshToken;
    const rawRefreshToken = cookieToken ?? bodyToken;

    if (!rawRefreshToken) {
      res.status(HttpStatus.UNAUTHORIZED).json({ message: 'No refresh token provided' });
      return;
    }

    const { accessToken, refreshToken } = await this.authService.refreshTokens(rawRefreshToken);

    if (cookieToken) {
      res.cookie(REFRESH_COOKIE, refreshToken, {
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'strict',
        maxAge: COOKIE_MAX_AGE_MS,
      });
      res.json({ accessToken });
    } else {
      res.json({ accessToken, refreshToken });
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke session' })
  async logout(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cookieToken = (req.cookies as Record<string, string>)[REFRESH_COOKIE];
    const bodyToken = (req.body as { refreshToken?: string }).refreshToken;
    const rawRefreshToken = cookieToken ?? bodyToken;

    if (rawRefreshToken) {
      await this.authService.logout(rawRefreshToken);
    }

    res.clearCookie(REFRESH_COOKIE);
    res.status(HttpStatus.NO_CONTENT).send();
  }
}
