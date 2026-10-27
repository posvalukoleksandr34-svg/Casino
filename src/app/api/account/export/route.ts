import { NextResponse } from 'next/server';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { exportUserData } from '@/server/users/accounts';
import { audit } from '@/server/audit/audit';
import { getDb } from '@/server/db/client';

export const GET = route({ name: 'account.export', auth: 'user', onboarding: 'allow', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => {
  const data = await exportUserData(ctx.session.userId);
  await audit(getDb(), { actorId: ctx.session.userId, actorType: 'USER', action: 'user.data_exported', ipHash: ctx.ipHash });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="aurovane-data-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
});
