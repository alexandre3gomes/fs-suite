import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

import { isUserAdmin } from '../auth/admin-emails';
import type { PrismaService } from '../prisma/prisma.service';

export interface ContactInput {
  email: string;
  name: string;
  isAdmin: boolean;
  locale: string | null;
  marketingEmailConsent: boolean;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

function maskEmail(email: string): string {
  const [u, d] = email.split('@');
  return `${(u ?? '').slice(0, 2)}***@${d ?? ''}`;
}

/** Normalize any locale (Google's, the app's) to the two app languages. */
function normalizeLocale(locale: string | null | undefined): string {
  return (locale ?? '').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

/**
 * Mirrors users into the Resend marketing Audience (the broadcast list) with
 * custom properties for segmentation:
 *   - `language` ("pt-BR" / "en") — send announcements in the right language
 *   - `is_admin` ("true" / "false") — Resend properties are string/number only
 *
 * The DB (`User.marketingEmailConsent` + `locale` + admin status) is the source
 * of truth; this pushes the projection. All write paths are best-effort (never
 * block the user action); drift is reconciled by backfillAll(). Gated to
 * production (or RESEND_AUDIENCE_FORCE=true). Requires RESEND_API_KEY +
 * RESEND_AUDIENCE_ID.
 */
@Injectable()
export class ResendAudienceService {
  private readonly logger = new Logger(ResendAudienceService.name);
  private readonly resend: Resend | null;
  private readonly audienceId: string | undefined;
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.audienceId = config.get<string>('RESEND_AUDIENCE_ID');
    const isProd = config.get<string>('NODE_ENV') === 'production';
    const force = config.get<string>('RESEND_AUDIENCE_FORCE') === 'true';
    this.enabled = !!this.resend && !!this.audienceId && (isProd || force);
    if (!this.enabled) {
      this.logger.log('Resend audience sync disabled (non-prod, or API key / audience id missing)');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private payloadFor(input: ContactInput): {
    audienceId: string;
    email: string;
    firstName: string;
    lastName: string;
    unsubscribed: boolean;
    properties: { language: string; is_admin: string };
  } {
    const { firstName, lastName } = splitName(input.name);
    return {
      audienceId: this.audienceId!,
      email: input.email,
      firstName,
      lastName,
      unsubscribed: !input.marketingEmailConsent,
      properties: {
        language: normalizeLocale(input.locale),
        is_admin: input.isAdmin ? 'true' : 'false',
      },
    };
  }

  /**
   * Upsert a contact (create on signup, update on any change). Best-effort —
   * tries update first (the common case), falls back to create if absent.
   */
  async syncContact(input: ContactInput): Promise<void> {
    if (!this.enabled) return;
    const payload = this.payloadFor(input);
    try {
      const updated = await this.resend!.contacts.update(payload);
      if (updated.error) {
        const created = await this.resend!.contacts.create(payload);
        if (created.error) {
          this.logger.warn(
            `contact sync failed for ${maskEmail(input.email)}: ${created.error.message}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(`contact sync threw for ${maskEmail(input.email)}: ${(err as Error).message}`);
    }
  }

  /** Remove a contact on account erasure (LGPD). Best-effort. */
  async removeContact(email: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.resend!.contacts.remove({ audienceId: this.audienceId!, email });
    } catch (err) {
      this.logger.warn(`contact remove threw for ${maskEmail(email)}: ${(err as Error).message}`);
    }
  }

  /** Define the custom properties used for segmentation (idempotent). */
  async ensureProperties(): Promise<void> {
    if (!this.enabled) return;
    const props: { key: string; type: 'string'; fallbackValue: string }[] = [
      { key: 'language', type: 'string', fallbackValue: 'pt-BR' },
      { key: 'is_admin', type: 'string', fallbackValue: 'false' },
    ];
    for (const p of props) {
      try {
        const res = await this.resend!.contactProperties.create(p);
        if (res.error) {
          // Already-exists is expected on re-runs — log at debug only.
          this.logger.debug(`contact property ${p.key}: ${res.error.message}`);
        }
      } catch (err) {
        this.logger.debug(`contact property ${p.key} threw: ${(err as Error).message}`);
      }
    }
  }

  /** Upsert every active user into the audience. Backfill / reconcile drift. */
  async backfillAll(prisma: PrismaService): Promise<{ total: number; ok: number; failed: number }> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Resend audience sync is not enabled');
    }
    await this.ensureProperties();
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: { email: true, name: true, isAdmin: true, locale: true, marketingEmailConsent: true },
    });
    let ok = 0;
    let failed = 0;
    for (const u of users) {
      const payload = this.payloadFor({
        email: u.email,
        name: u.name,
        isAdmin: isUserAdmin(u),
        locale: u.locale,
        marketingEmailConsent: u.marketingEmailConsent,
      });
      try {
        const created = await this.resend!.contacts.create(payload);
        if (created.error) {
          const updated = await this.resend!.contacts.update(payload);
          updated.error ? failed++ : ok++;
        } else {
          ok++;
        }
      } catch {
        failed++;
      }
    }
    this.logger.log(`Audience backfill: ${ok}/${users.length} ok, ${failed} failed`);
    return { total: users.length, ok, failed };
  }
}
