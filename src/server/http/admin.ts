import type { UserContext } from './handler';
import type { AdminCtx } from '../admin/admin-service';

export function adminCtx(ctx: UserContext<unknown>): AdminCtx {
  return { adminId: ctx.session.userId, ipHash: ctx.ipHash, requestId: ctx.requestId };
}
