import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { accountDetails, detailsSchema, updateAccountDetails } from '@/server/users/onboarding';

function view(d: Awaited<ReturnType<typeof accountDetails>>) {
  return {
    firstName: d.firstName,
    lastName: d.lastName,
    dateOfBirth: d.dateOfBirth,
    countryCode: d.countryCode,
    country: d.countryName,
    phone: d.phoneE164,
    phoneVerified: d.phoneVerified,
    emailVerifiedAt: d.emailVerifiedAt?.toISOString() ?? null,
    emailVerification: d.emailVerificationMethod,
    onboardingCompletedAt: d.onboardingCompletedAt?.toISOString() ?? null,
  };
}

export const GET = route({ name: 'account.details', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async (ctx) => ({ details: view(await accountDetails(ctx.session.userId)) }));

export const PATCH = route({ name: 'account.details.update', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => {
  const body = await readJson(ctx.req, detailsSchema);
  return { details: view(await updateAccountDetails(ctx.session.userId, body, { ipHash: ctx.ipHash, requestId: ctx.requestId })) };
});
