import { z } from 'zod';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { claimBonus } from '@/server/promotions/campaigns';

const schema = z.union([
  z.object({ campaignId: z.int().positive() }).strict(),
  z.object({ code: z.string().trim().min(4).max(20).regex(/^[A-Za-z0-9]+$/, 'Codes are letters and digits only') }).strict(),
]);

/** Claims a welcome offer or a promo code (virtual bonus credits; once per offer). */
export const POST = route({ name: 'promotions.claim', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser, RATE_LIMITS.promoCodeUser] }, async ({ req, session }) => {
  const body = await readJson(req, schema);
  return claimBonus(session.userId, body);
});
