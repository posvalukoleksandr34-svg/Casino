/**
 * Domain errors with stable machine-readable codes. The HTTP layer maps them
 * to status codes; messages are safe to show to end users.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CSRF_REJECTED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_FUNDS'
  | 'RISK_LIMIT'
  | 'GAME_UNAVAILABLE'
  | 'GAME_RULE'
  | 'RESPONSIBLE_GAMING'
  | 'IDEMPOTENCY_CONFLICT'
  | 'ACCOUNT_LOCKED'
  | 'MFA_REQUIRED'
  | 'EMAIL_NOT_VERIFIED'
  | 'ONBOARDING_REQUIRED'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_REJECTED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  INSUFFICIENT_FUNDS: 422,
  RISK_LIMIT: 422,
  GAME_RULE: 422,
  RESPONSIBLE_GAMING: 403,
  GAME_UNAVAILABLE: 503,
  ACCOUNT_LOCKED: 423,
  MFA_REQUIRED: 401,
  EMAIL_NOT_VERIFIED: 403,
  ONBOARDING_REQUIRED: 403,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }
}

export const errors = {
  validation: (message: string, details?: Record<string, unknown>) => new AppError('VALIDATION_ERROR', message, details),
  unauthenticated: (message = 'Please sign in to continue') => new AppError('UNAUTHENTICATED', message),
  forbidden: (message = 'You do not have permission to perform this action') => new AppError('FORBIDDEN', message),
  notFound: (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`),
  conflict: (message: string, details?: Record<string, unknown>) => new AppError('CONFLICT', message, details),
  insufficientFunds: (details?: Record<string, unknown>) =>
    new AppError('INSUFFICIENT_FUNDS', 'Insufficient balance for this wager', details),
  risk: (message: string, details?: Record<string, unknown>) => new AppError('RISK_LIMIT', message, details),
  gameUnavailable: (message: string) => new AppError('GAME_UNAVAILABLE', message),
  responsible: (message: string, details?: Record<string, unknown>) =>
    new AppError('RESPONSIBLE_GAMING', message, details),
  rateLimited: (retryAfterSeconds: number) =>
    new AppError('RATE_LIMITED', 'Too many requests, please slow down', { retryAfterSeconds }),
};
