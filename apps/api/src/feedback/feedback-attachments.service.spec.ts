import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import type { R2StorageService } from '../r2/r2-storage.service';

import {
  FeedbackAttachmentsService,
  MAX_ATTACHMENT_BYTES,
  type ProcessedAttachment,
} from './feedback-attachments.service';

// R2 is never touched by validate(); store() is exercised with a stub.
const r2Stub = {
  putObject: async (): Promise<void> => undefined,
} as unknown as R2StorageService;

const service = new FeedbackAttachmentsService(r2Stub);

function file(
  buffer: Buffer,
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    buffer,
    size: buffer.length,
    originalname: 'test.bin',
    mimetype: 'application/octet-stream',
    fieldname: 'files',
    encoding: '7bit',
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  } as Express.Multer.File;
}

let pngBuffer: Buffer;

beforeAll(async () => {
  pngBuffer = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#3366cc' },
  })
    .png()
    .toBuffer();
});

describe('FeedbackAttachmentsService.validate', () => {
  it('accepts a real PNG and reports image/png', async () => {
    const out = await service.validate([file(pngBuffer, { originalname: 'shot.png' })]);
    expect(out).toHaveLength(1);
    expect(out[0]?.contentType).toBe('image/png');
    expect(out[0]?.fileName).toBe('shot.png');
    expect(out[0]?.buffer.length).toBeGreaterThan(0);
  });

  it('accepts a PDF by its header', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32)]);
    const out = await service.validate([file(pdf, { originalname: 'log.pdf' })]);
    expect(out[0]?.contentType).toBe('application/pdf');
  });

  it('rejects a non-allow-listed type (no matching magic bytes)', async () => {
    const text = Buffer.from('just some text, not a real file');
    await expect(service.validate([file(text)])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a payload masquerading as an image via its declared name', async () => {
    // .png name but HTML/script bytes — magic-byte sniff must reject it.
    const fake = Buffer.from('<script>alert(1)</script>');
    await expect(
      service.validate([file(fake, { originalname: 'evil.png', mimetype: 'image/png' })]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects files over the size limit', async () => {
    const big = file(pngBuffer, { size: MAX_ATTACHMENT_BYTES + 1 });
    await expect(service.validate([big])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects more than the maximum number of files', async () => {
    const four = [pngBuffer, pngBuffer, pngBuffer, pngBuffer].map((b) => file(b));
    await expect(service.validate(four)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sanitizes path separators out of the stored file name', async () => {
    const out = await service.validate([
      file(pngBuffer, { originalname: '../../etc/passwd.png' }),
    ]);
    expect(out[0]?.fileName).not.toContain('/');
  });
});

describe('FeedbackAttachmentsService.store (required storage)', () => {
  const processed: ProcessedAttachment[] = [
    { buffer: Buffer.from('a'), contentType: 'image/png', fileName: 'a.png', sizeBytes: 1 },
    { buffer: Buffer.from('b'), contentType: 'image/png', fileName: 'b.png', sizeBytes: 1 },
  ];

  it('throws and rolls back partial uploads when a required PUT fails', async () => {
    const deleted: string[] = [];
    let calls = 0;
    const r2 = {
      putObjectOrThrow: async (): Promise<void> => {
        calls += 1;
        if (calls === 2) throw new Error('R2 down');
      },
      deleteObject: async (key: string): Promise<void> => {
        deleted.push(key);
      },
    } as unknown as R2StorageService;

    const svc = new FeedbackAttachmentsService(r2);
    await expect(svc.store('fb1', processed)).rejects.toThrow('R2 down');
    // The first (successful) upload must be cleaned up so no orphan lingers.
    expect(deleted).toHaveLength(1);
  });

  it('returns metadata keyed under the feedback prefix when uploads succeed', async () => {
    const r2 = {
      putObjectOrThrow: async (): Promise<void> => undefined,
      deleteObject: async (): Promise<void> => undefined,
    } as unknown as R2StorageService;

    const svc = new FeedbackAttachmentsService(r2);
    const out = await svc.store('fb1', [processed[0] as ProcessedAttachment]);
    expect(out).toHaveLength(1);
    expect(out[0]?.storageKey).toContain('feedback/fb1/');
  });
});
