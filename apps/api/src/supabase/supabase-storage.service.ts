import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin wrapper over Supabase Storage's REST API (no SDK — just fetch), mirroring
 * the db-backup workflow. Used to host email-communication screenshots in a
 * public bucket so the rendered email can <img src> them directly. R2 stays
 * dedicated to charts.
 */
@Injectable()
export class SupabaseStorageService implements OnModuleInit {
  static readonly BUCKET = 'communications';

  private readonly logger = new Logger(SupabaseStorageService.name);
  private url = '';
  private serviceKey = '';
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.url = (this.config.get<string>('SUPABASE_URL') ?? '').replace(/\/$/, '');
    this.serviceKey = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    this.enabled = Boolean(this.url && this.serviceKey);
    if (!this.enabled) {
      this.logger.warn('Supabase Storage disabled — SUPABASE_URL/SERVICE_ROLE_KEY not set');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
      ...extra,
    };
  }

  /** Create the public bucket on first use; a "Duplicate" response is success. */
  async ensureBucket(): Promise<void> {
    const res = await fetch(`${this.url}/storage/v1/bucket`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        id: SupabaseStorageService.BUCKET,
        name: SupabaseStorageService.BUCKET,
        public: true,
      }),
    });
    if (res.ok) return;
    const text = await res.text();
    if (text.includes('Duplicate') || res.status === 409) return;
    throw new Error(`Supabase bucket setup failed (HTTP ${res.status}): ${text}`);
  }

  /** Upload an object and return its public URL. */
  async upload(path: string, body: Buffer, contentType: string): Promise<string> {
    await this.ensureBucket();
    const res = await fetch(
      `${this.url}/storage/v1/object/${SupabaseStorageService.BUCKET}/${path}`,
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': contentType, 'x-upsert': 'true' }),
        body: new Uint8Array(body),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase upload failed (HTTP ${res.status}): ${text}`);
    }
    return this.publicUrl(path);
  }

  publicUrl(path: string): string {
    return `${this.url}/storage/v1/object/public/${SupabaseStorageService.BUCKET}/${path}`;
  }
}
