import * as crypto from 'crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Session, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { ActivityService } from '../activity/activity.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { ResendAudienceService } from '../email/resend-audience.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

import { isUserAdmin } from './admin-emails';

interface OAuthUserProfile {
  provider: string;
  providerAccountId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  locale?: string;
  accessToken?: string;
  refreshToken?: string;
}

interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface RefreshPayload {
  sub: string;
  sid: string;
  type: string;
}

const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;
const AUTH_CODE_PREFIX = 'auth_code:';
const AUTH_CODE_TTL_SECONDS = 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    private readonly activity: ActivityService,
    private readonly redis: RedisService,
    private readonly audience: ResendAudienceService,
  ) {}

  async upsertOAuthUser(profile: OAuthUserProfile): Promise<User> {
    const encryptedAccessToken = profile.accessToken
      ? this.encryption.encrypt(profile.accessToken)
      : null;
    const encryptedRefreshToken = profile.refreshToken
      ? this.encryption.encrypt(profile.refreshToken)
      : null;

    const user = await this.prisma.user.upsert({
      where: { email: profile.email },
      update: {
        name: profile.name,
        avatarUrl: profile.avatarUrl ?? null,
      },
      create: {
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl ?? null,
        locale: profile.locale ?? null,
      },
    });

    // First login → add to the Resend marketing audience (best-effort). On
    // create, createdAt === updatedAt; returning users have updatedAt bumped.
    if (user.createdAt.getTime() === user.updatedAt.getTime()) {
      void this.audience.syncContact({
        email: user.email,
        name: user.name,
        isAdmin: isUserAdmin(user),
        locale: user.locale,
        marketingEmailConsent: user.marketingEmailConsent,
      });
    }

    await this.prisma.oAuthAccount.upsert({
      where: {
        provider_providerAccountId: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      },
      update: {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
      },
      create: {
        userId: user.id,
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
      },
    });

    return user;
  }

  async createSession(user: User, meta: SessionMeta): Promise<TokenPair> {
    const sessionId = crypto.randomUUID();

    const rawRefreshToken = this.jwt.sign(
      { sub: user.id, sid: sessionId, type: 'refresh' },
      { expiresIn: '30d' },
    );

    const refreshTokenHash = await bcrypt.hash(rawRefreshToken, BCRYPT_ROUNDS);

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshTokenHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
    });

    const accessToken = this.jwt.sign(
      { sub: user.id, email: user.email },
      { expiresIn: '15m' },
    );

    // Fire-and-forget — login event must not block the auth response
    void this.activity.log('auth.login', user.id);

    return { accessToken, refreshToken: rawRefreshToken };
  }

  async refreshTokens(rawRefreshToken: string): Promise<TokenPair> {
    let payload: RefreshPayload;
    try {
      payload = this.jwt.verify<RefreshPayload>(rawRefreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const session: (Session & { user: User }) | null = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      if (session) {
        await this.prisma.session.delete({ where: { id: session.id } });
      }
      throw new UnauthorizedException('Session expired or not found');
    }

    const isValid = await bcrypt.compare(rawRefreshToken, session.refreshTokenHash);
    if (!isValid) {
      await this.prisma.session.deleteMany({ where: { userId: session.userId } });
      throw new UnauthorizedException('Token reuse detected — all sessions invalidated');
    }

    await this.prisma.session.delete({ where: { id: session.id } });

    return this.createSession(session.user, {
      userAgent: session.userAgent ?? undefined,
      ipAddress: session.ipAddress ?? undefined,
    });
  }

  async logout(rawRefreshToken: string): Promise<void> {
    let payload: RefreshPayload;
    try {
      payload = this.jwt.verify<RefreshPayload>(rawRefreshToken);
    } catch {
      return;
    }

    await this.prisma.session.deleteMany({ where: { id: payload.sid } });
    void this.activity.log('auth.logout', payload.sub);
  }

  async storeAuthCode(tokens: TokenPair): Promise<string> {
    const code = crypto.randomBytes(32).toString('hex');
    const client = this.redis.getClient();
    await client.setEx(
      `${AUTH_CODE_PREFIX}${code}`,
      AUTH_CODE_TTL_SECONDS,
      JSON.stringify(tokens),
    );
    return code;
  }

  async exchangeAuthCode(code: string): Promise<TokenPair> {
    const client = this.redis.getClient();
    const key = `${AUTH_CODE_PREFIX}${code}`;
    const raw = await client.getDel(key);

    if (!raw) {
      throw new UnauthorizedException('Invalid or expired auth code');
    }

    return JSON.parse(raw) as TokenPair;
  }

  getWebOrigin(): string {
    return this.config.getOrThrow<string>('WEB_ORIGIN');
  }
}
