import { Readable } from 'stream';

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const MAX_STORAGE_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB safety limit

@Injectable()
export class R2StorageService implements OnModuleInit {
  private client: S3Client | null = null;
  private bucket = '';
  private enabled = false;
  private readonly logger = new Logger(R2StorageService.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const accountId = this.config.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');
    // Optional endpoint override for local dev — points at the MinIO container
    // instead of Cloudflare R2. When set, S3 path-style addressing is required.
    const endpointOverride = this.config.get<string>('R2_ENDPOINT');
    this.bucket = this.config.get<string>('R2_BUCKET_NAME', 'fs-suite-charts');

    const endpoint =
      endpointOverride ??
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

    if (!accessKeyId || !secretAccessKey || !endpoint) {
      this.logger.warn('R2 disabled — no credentials/endpoint configured');
      return;
    }

    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      // MinIO (and most non-AWS S3) need path-style; Cloudflare R2 uses the
      // virtual-hosted default, so only force it for the local override.
      forcePathStyle: Boolean(endpointOverride),
    });
    this.enabled = true;
    this.logger.log(`R2 enabled — endpoint: ${endpoint}, bucket: ${this.bucket}`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async getObject(key: string): Promise<{ body: Readable; contentLength?: number } | null> {
    if (!this.enabled || !this.client) return null;
    try {
      const resp = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!resp.Body) return null;
      return { body: resp.Body as Readable, contentLength: resp.ContentLength };
    } catch (err: unknown) {
      const code = (err as { name?: string }).name;
      if (code === 'NoSuchKey') return null;
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return null;
      this.logger.warn(`R2 GET failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.enabled || !this.client) return;
    if (body.length > MAX_STORAGE_BYTES) return;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      this.logger.debug(`R2 PUT ${key} (${(body.length / 1024).toFixed(0)} KB)`);
    } catch (err: unknown) {
      this.logger.warn(`R2 PUT failed for ${key}: ${(err as Error).message}`);
    }
  }

  /**
   * Required PUT: throws if storage is unavailable or the upload fails. Use for
   * data that must be durably stored before we record it (e.g. feedback
   * attachments) — unlike `putObject`, which is best-effort for cache writes.
   */
  async putObjectOrThrow(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.enabled || !this.client) {
      throw new Error('Object storage is not configured');
    }
    if (body.length > MAX_STORAGE_BYTES) {
      throw new Error('Object exceeds maximum storage size');
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    this.logger.debug(`R2 PUT(required) ${key} (${(body.length / 1024).toFixed(0)} KB)`);
  }

  /** Best-effort delete. A missing object is treated as a successful no-op. */
  async deleteObject(key: string): Promise<void> {
    if (!this.enabled || !this.client) return;
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      this.logger.debug(`R2 DELETE ${key}`);
    } catch (err: unknown) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return;
      this.logger.warn(`R2 DELETE failed for ${key}: ${(err as Error).message}`);
    }
  }
}
