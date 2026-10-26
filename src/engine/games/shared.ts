import { z } from 'zod';
import { MAX_AMOUNT } from '../money';

/** A positive stake in minor units. */
export const stakeSchema = z.int().positive().max(MAX_AMOUNT);
