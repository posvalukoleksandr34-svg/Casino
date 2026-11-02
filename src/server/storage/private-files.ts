/**
 * Private file storage for identity documents and support attachments.
 *
 * Files are written under UPLOAD_DIR (never under public/) with a random name
 * and owner-only permissions, and are only ever read back through routes that
 * check who is asking. The database keeps metadata and the storage key.
 * Uploads are accepted only when their bytes are a JPEG, PNG or PDF (the
 * declared type and file name are not trusted), up to 5 MB, and PDFs with
 * active content (JavaScript, launch actions, embedded files) are refused.
 *
 * This is a local-disk implementation. A deployment with several application
 * instances needs shared storage: implement the same three functions against
 * an object store with server-side encryption (docs/payments.md → uploads).
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env';
import { errors } from '../errors';
import type { UploadContentType } from '../db/schema';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export type StorageNamespace = 'kyc' | 'support';

export interface CheckedUpload {
  bytes: Buffer;
  contentType: UploadContentType;
  fileName: string;
  sha256: string;
}

function root(): string {
  return path.resolve(env().UPLOAD_DIR ?? path.join(process.cwd(), 'var', 'uploads'));
}

/** The real type of a file, from its first bytes; null if it is not an accepted type. */
export function sniffType(bytes: Buffer): UploadContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const ACTIVE_PDF = /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA)\b/;

/** A safe display name: no path, no control characters, at most 120 characters, with an extension matching the real type. */
export function safeFileName(name: string, type: UploadContentType): string {
  const base = path.basename(name.replace(/\\/g, '/')).replace(/[^\w .()-]/g, '_').replace(/\s+/g, ' ').trim();
  const ext = type === 'image/jpeg' ? '.jpg' : type === 'image/png' ? '.png' : '.pdf';
  const stem = (base.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'file').slice(0, 100);
  return `${stem}${ext}`;
}

/** Validates an upload by its content. Throws a validation error the player can read. */
export function checkUpload(bytes: Buffer, declaredName: string): CheckedUpload {
  if (bytes.length === 0) throw errors.validation('The file is empty.');
  if (bytes.length > MAX_UPLOAD_BYTES) throw errors.validation('Files can be at most 5 MB.');
  const contentType = sniffType(bytes);
  if (!contentType) throw errors.validation('Only JPEG, PNG and PDF files are accepted.');
  if (contentType === 'application/pdf' && ACTIVE_PDF.test(bytes.toString('latin1'))) {
    throw errors.validation('This PDF contains scripts or embedded content. Please upload a plain scan or photo.');
  }
  return { bytes, contentType, fileName: safeFileName(declaredName, contentType), sha256: createHash('sha256').update(bytes).digest('hex') };
}

const KEY = /^(kyc|support)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function putPrivateFile(ns: StorageNamespace, bytes: Buffer): Promise<string> {
  const key = `${ns}/${randomUUID()}`;
  const dir = path.join(root(), ns);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(root(), key), bytes, { mode: 0o600, flag: 'wx' });
  return key;
}

export async function readPrivateFile(key: string): Promise<Buffer> {
  if (!KEY.test(key)) throw errors.notFound('File');
  try {
    return await readFile(path.join(root(), key));
  } catch {
    throw errors.notFound('File');
  }
}

/** A download response that browsers will not render inline or sniff into another type. */
export function privateFileResponse(bytes: Buffer, contentType: string, fileName: string): Response {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="${ascii}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}

/**
 * Reads a multipart form with at most one file field named "file". The body
 * size is limited before it is parsed; text fields are returned as strings.
 */
export async function readUpload(req: Request): Promise<{ fields: Record<string, string>; file: { name: string; bytes: Buffer } | null }> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('multipart/form-data')) throw errors.validation('Send the form as multipart/form-data');
  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) throw errors.validation('Files can be at most 5 MB.');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw errors.validation('The upload could not be read.');
  }
  const fields: Record<string, string> = {};
  let file: { name: string; bytes: Buffer } | null = null;
  for (const [k, v] of form.entries()) {
    if (typeof v === 'string') {
      if (v.length > 10_000) throw errors.validation('A field is too long.');
      fields[k] = v;
    } else if (k === 'file' && v.size > 0) {
      if (file) throw errors.validation('Upload one file at a time.');
      if (v.size > MAX_UPLOAD_BYTES) throw errors.validation('Files can be at most 5 MB.');
      file = { name: v.name || 'file', bytes: Buffer.from(await v.arrayBuffer()) };
    }
  }
  return { fields, file };
}
