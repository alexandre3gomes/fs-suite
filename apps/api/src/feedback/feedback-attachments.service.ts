import { randomUUID } from 'crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

import { R2StorageService } from '../r2/r2-storage.service';

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB

/** A file that passed validation and is ready to store. */
export interface ProcessedAttachment {
  buffer: Buffer;
  contentType: string;
  fileName: string;
  sizeBytes: number;
}

/** A stored attachment's persistable metadata. */
export interface StoredAttachment {
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

type SniffedKind = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Validates and stores feedback attachments. Defends against arbitrary-content
 * execution by (1) sniffing real magic bytes rather than trusting the declared
 * MIME, and (2) re-encoding images through sharp so any embedded/polyglot
 * payload is stripped and only a genuine raster survives. PDFs are accepted
 * after a header check and always served with an `attachment` disposition.
 */
@Injectable()
export class FeedbackAttachmentsService {
  private readonly logger = new Logger(FeedbackAttachmentsService.name);

  constructor(private readonly r2: R2StorageService) {}

  /** Sniff allow-listed file kinds from magic bytes. Returns null if unknown. */
  private sniff(buf: Buffer): SniffedKind | null {
    if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) {
      return 'image/png';
    }
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }
    if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') {
      return 'application/pdf';
    }
    return null;
  }

  /**
   * Keep a short, safe display name: drop path separators and any control
   * characters, cap the length. Falls back to a generic name with the right
   * extension if nothing usable remains.
   */
  private sanitizeName(name: string | undefined, fallbackExt: string): string {
    const cleaned = Array.from(name ?? '')
      .filter((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code >= 0x20 && code !== 0x7f && ch !== '/' && ch !== '\\';
      })
      .join('')
      .trim()
      .slice(0, 100);
    return cleaned || `anexo.${fallbackExt}`;
  }

  /**
   * Validate every uploaded file. Throws BadRequestException (pt-BR message) on
   * any violation so nothing is persisted for an invalid submission. Returns the
   * processed (re-encoded) buffers ready to store.
   */
  async validate(files: Express.Multer.File[]): Promise<ProcessedAttachment[]> {
    if (files.length > MAX_ATTACHMENTS) {
      throw new BadRequestException(`No máximo ${MAX_ATTACHMENTS} arquivos por envio.`);
    }

    const out: ProcessedAttachment[] = [];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        throw new BadRequestException('Cada arquivo deve ter no máximo 5 MB.');
      }
      const kind = this.sniff(file.buffer);
      if (!kind) {
        throw new BadRequestException(
          'Tipo de arquivo não suportado. Envie imagens (PNG, JPG, WEBP) ou PDF.',
        );
      }

      if (kind === 'application/pdf') {
        out.push({
          buffer: file.buffer,
          contentType: 'application/pdf',
          fileName: this.sanitizeName(file.originalname, 'pdf'),
          sizeBytes: file.size,
        });
        continue;
      }

      // Image: re-encode to neutralize any embedded payload and prove it's real.
      try {
        const img = sharp(file.buffer, { failOn: 'error' });
        let buffer: Buffer;
        let ext: string;
        if (kind === 'image/png') {
          buffer = await img.png().toBuffer();
          ext = 'png';
        } else if (kind === 'image/jpeg') {
          buffer = await img.jpeg().toBuffer();
          ext = 'jpg';
        } else {
          buffer = await img.webp().toBuffer();
          ext = 'webp';
        }
        out.push({
          buffer,
          contentType: kind,
          fileName: this.sanitizeName(file.originalname, ext),
          sizeBytes: buffer.length,
        });
      } catch {
        throw new BadRequestException('Não foi possível processar uma das imagens enviadas.');
      }
    }
    return out;
  }

  /**
   * Store processed attachments in R2 under the feedback's key prefix. Storage
   * is REQUIRED — if any upload fails (or R2 is unconfigured) this throws after
   * cleaning up whatever it already wrote, so we never record metadata for
   * objects that aren't actually there.
   */
  async store(feedbackId: string, processed: ProcessedAttachment[]): Promise<StoredAttachment[]> {
    const stored: StoredAttachment[] = [];
    try {
      for (const p of processed) {
        const key = `feedback/${feedbackId}/${randomUUID()}-${p.fileName}`;
        await this.r2.putObjectOrThrow(key, p.buffer, p.contentType);
        stored.push({
          storageKey: key,
          fileName: p.fileName,
          contentType: p.contentType,
          sizeBytes: p.sizeBytes,
        });
      }
    } catch (err) {
      // Roll back partial uploads so no orphan objects linger in the bucket.
      await Promise.all(stored.map((s) => this.r2.deleteObject(s.storageKey)));
      this.logger.warn(`Feedback attachment storage failed for ${feedbackId}: ${(err as Error).message}`);
      throw err;
    }
    return stored;
  }
}
