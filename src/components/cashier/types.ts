/** Shapes of the server's cashier responses (see server/payments). Amounts are integer minor units. */
export interface CashierCurrency {
  code: string;
  label: string;
  real: boolean;
}

export interface DepositMethodView {
  id: string;
  name: string;
  kind: 'CARD' | 'BANK_TRANSFER' | 'E_WALLET';
  sandbox: boolean;
  min: number;
  max: number;
  feeFixed: number;
  feeBp: number;
  processingTime: string;
}

export interface DepositBonusView {
  id: number;
  name: string;
  description: string;
  depositNumber: number | null;
  matchPercent: number;
  fixedAmount: number;
  maxBonus: number;
  minDeposit: number;
  wageringMultiplier: number;
  maxBet: number | null;
  expiresAfterDays: number;
  available: boolean;
  reason: string | null;
}

export interface DepositOptionsView {
  mode: 'sandbox' | 'disabled';
  currency: CashierCurrency;
  blocker: string | null;
  allowance: { dailyLimit: number; monthlyLimit: number; usedDay: number; usedMonth: number; remaining: number; playerDailyLimit: number | null; playerMonthlyLimit: number | null };
  methods: DepositMethodView[];
  bonuses: DepositBonusView[];
}

export interface WithdrawalMethodView extends DepositMethodView {
  available: boolean;
  reason: string | null;
}

export interface WithdrawalOptionsView {
  mode: 'sandbox' | 'disabled';
  currency: CashierCurrency;
  balance: number;
  withdrawable: number;
  lockedBonus: number;
  pending: number;
  limits: { daily: number; monthly: number; usedDay: number; usedMonth: number; remaining: number };
  reviewThreshold: number;
  closedLoop: boolean;
  kyc: { required: boolean; status: string };
  blockers: string[];
  methods: WithdrawalMethodView[];
}

export interface DepositView {
  id: string;
  method: string;
  methodId: string;
  sandbox: boolean;
  amount: number;
  fee: number;
  credited: number;
  currency: string;
  status: string;
  reference: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
}

export interface WithdrawalView {
  id: string;
  method: string;
  methodId: string;
  sandbox: boolean;
  amount: number;
  fee: number;
  payout: number;
  currency: string;
  status: string;
  reference: string | null;
  reviewNote: string | null;
  approvals: number;
  failureReason: string | null;
  requestedAt: string;
  completedAt: string | null;
  cancellable: boolean;
}

/** Display-only fee estimate; the server computes the real fee. */
export function feeFor(amount: number, fixed: number, bp: number): number {
  return fixed + Math.floor((amount * bp) / 10_000);
}

export const KIND_LABELS: Record<DepositMethodView['kind'], string> = { CARD: 'Card', BANK_TRANSFER: 'Bank transfer', E_WALLET: 'E-wallet' };

export const DEPOSIT_STATUS: Record<string, { label: string; tone: 'positive' | 'warning' | 'negative' | 'neutral' | 'info' }> = {
  CREATED: { label: 'Created', tone: 'info' },
  PENDING: { label: 'Waiting for payment', tone: 'info' },
  PROCESSING: { label: 'Processing', tone: 'info' },
  COMPLETED: { label: 'Completed', tone: 'positive' },
  FAILED: { label: 'Failed', tone: 'negative' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  UNDER_REVIEW: { label: 'Under review', tone: 'warning' },
};

export const WITHDRAWAL_STATUS: Record<string, { label: string; tone: 'positive' | 'warning' | 'negative' | 'neutral' | 'info' }> = {
  REQUESTED: { label: 'Requested', tone: 'info' },
  PENDING: { label: 'Pending', tone: 'info' },
  UNDER_REVIEW: { label: 'Under review', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'info' },
  PROCESSING: { label: 'Being paid out', tone: 'info' },
  COMPLETED: { label: 'Paid', tone: 'positive' },
  REJECTED: { label: 'Rejected — returned', tone: 'negative' },
  CANCELLED: { label: 'Cancelled — returned', tone: 'neutral' },
  FAILED: { label: 'Failed — returned', tone: 'negative' },
};
