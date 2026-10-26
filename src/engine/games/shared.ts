import { z } from 'zod';
import { MAX_STAKE } from '../money';

/** A positive stake in minor units (≤ MAX_STAKE, so payouts stay within MAX_AMOUNT). */
export const stakeSchema = z.int().positive().max(MAX_STAKE);
