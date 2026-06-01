import * as crypto from 'crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Stateless unsubscribe tokens: HMAC-SHA256 of the userId keyed by
 * ENCRYPTION_KEY. No DB column needed — the link in every email carries
 * `?u=<userId>&t=<token>` and we recompute + constant-time compare on click.
 */
@Injectable()
export class EmailTokenService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('ENCRYPTION_KEY'), 'hex');
  }

  sign(userId: string): string {
    return crypto.createHmac('sha256', this.key).update(userId).digest('hex');
  }

  verify(userId: string, token: string): boolean {
    const expected = this.sign(userId);
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}
