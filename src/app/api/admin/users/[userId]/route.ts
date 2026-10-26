import { z } from 'zod';
import { userDetail } from '@/server/admin/admin-service';
import { errors } from '@/server/errors';
import { route } from '@/server/http/handler';

export const GET = route<'users:read', { userId: string }>({ name: 'admin.user', auth: 'users:read' }, async ({ params }) => {
  if (!z.uuid().safeParse(params.userId).success) throw errors.notFound('User');
  return userDetail(params.userId);
});
