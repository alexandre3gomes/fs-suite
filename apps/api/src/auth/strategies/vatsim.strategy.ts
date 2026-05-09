import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { User } from '@prisma/client';
import { Strategy } from 'passport-oauth2';

import { AuthService } from '../auth.service';

interface VatsimUserResponse {
  data: {
    cid: string;
    personal: {
      name_first: string;
      name_last: string;
      name_full: string;
      email: string;
    };
  };
}

@Injectable()
export class VatsimStrategy extends PassportStrategy(Strategy, 'vatsim') {
  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
  ) {
    const baseUrl = config.get<string>('VATSIM_OAUTH_BASE_URL', 'https://auth.vatsim.net');
    super({
      authorizationURL: `${baseUrl}/oauth/authorize`,
      tokenURL: `${baseUrl}/oauth/token`,
      clientID: config.get<string>('VATSIM_CLIENT_ID', ''),
      clientSecret: config.get<string>('VATSIM_CLIENT_SECRET', ''),
      callbackURL: config.get<string>('VATSIM_CALLBACK_URL', 'http://localhost:3001/v1/auth/vatsim/callback'),
      scope: ['full_name', 'email'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    _profile: unknown,
    done: (err: Error | null, user?: User) => void,
  ): Promise<void> {
    try {
      const baseUrl = this.config.get<string>('VATSIM_OAUTH_BASE_URL', 'https://auth.vatsim.net');
      const res = await fetch(`${baseUrl}/api/user`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });

      if (!res.ok) {
        done(new Error(`VATSIM user info request failed: ${res.status}`));
        return;
      }

      const body = (await res.json()) as VatsimUserResponse;
      const { cid, personal } = body.data;

      if (!personal.email) {
        done(new Error('No email provided by VATSIM'));
        return;
      }

      const user = await this.authService.upsertOAuthUser({
        provider: 'vatsim',
        providerAccountId: cid,
        email: personal.email,
        name: personal.name_full,
        accessToken,
        refreshToken,
      });

      done(null, user);
    } catch (err) {
      done(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
