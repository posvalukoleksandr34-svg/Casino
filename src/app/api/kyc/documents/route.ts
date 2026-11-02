import { z } from 'zod';
import { errors } from '@/server/errors';
import { parseInput, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { uploadKycDocument } from '@/server/kyc/kyc';
import { readUpload } from '@/server/storage/private-files';

const fields = z.object({ kind: z.enum(['ID_FRONT', 'ID_BACK', 'PROOF_OF_ADDRESS', 'SELFIE', 'OTHER']) }).strict();

/** Uploads one identity document (JPEG, PNG or PDF, up to 5 MB) to private storage. Uploading does not verify anything. */
export const POST = route({ name: 'kyc.upload', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser, RATE_LIMITS.uploadUser] }, async ({ req, session }) => {
  const { fields: raw, file } = await readUpload(req);
  const { kind } = parseInput(fields, raw);
  if (!file) throw errors.validation('Choose a file to upload.');
  return { document: await uploadKycDocument(session.userId, kind, file) };
});
