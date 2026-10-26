import { getDb } from '@/server/db/client';
import { route } from '@/server/http/handler';
import { fairnessOverview } from '@/server/fairness/seeds';

export const GET = route({ name: 'fairness.get', auth: 'user' }, async ({ session }) => fairnessOverview(getDb(), session.userId));
