export const TICKET_STATUS: Record<string, { label: string; tone: 'info' | 'warning' | 'positive' | 'neutral' }> = {
  OPEN: { label: 'Waiting for support', tone: 'info' },
  AWAITING_PLAYER: { label: 'Reply from support', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'positive' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};
