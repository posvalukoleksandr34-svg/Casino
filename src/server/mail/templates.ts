/**
 * Transactional e-mail templates: a plain-text part (always) and an HTML part
 * in Aurovane's visual identity (dark surface, restrained gold), built from
 * tables and inline styles because that is what mail clients render reliably.
 * Every interpolated value is HTML-escaped. No images, tracking pixels or
 * remote resources: nothing is loaded when the message is opened.
 */
import { VERIFICATION_TTL_MINUTES } from '@/lib/account-policy';
import { env, supportEmail } from '../env';
import type { MailMessage } from './mailer';

const INK = '#0b0c0f';
const SURFACE = '#15171c';
const BORDER = '#2a2d35';
const TEXT = '#e9e6df';
const MUTED = '#a5a39d';
const GOLD = '#d4b06a';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const FOOTER_TEXT =
  'Aurovane is a free social casino. Chips are virtual: they have no monetary value and cannot be bought, sold, transferred, withdrawn or exchanged.';

interface Block {
  /** Plain-text paragraph. */
  text: string;
  /** Optional HTML rendering (already escaped); defaults to the escaped text. */
  html?: string;
}

function layout(opts: { title: string; preheader: string; blocks: Block[]; highlight?: { label: string; value: string; mono?: boolean }; action?: { label: string; url: string } }): { text: string; html: string } {
  const support = supportEmail();
  const supportLine = support ? `Questions? Contact ${support}.` : '';
  const text = [
    opts.title,
    '',
    ...opts.blocks.flatMap((b, i) => (i === 1 && opts.highlight ? [`    ${opts.highlight.value}`, '', b.text, ''] : [b.text, ''])),
    ...(opts.highlight && opts.blocks.length < 2 ? [`    ${opts.highlight.value}`, ''] : []),
    ...(opts.action ? [`${opts.action.label}: ${opts.action.url}`, ''] : []),
    '—',
    FOOTER_TEXT,
    supportLine,
  ]
    .join('\n')
    .trim();

  const para = (b: Block) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${TEXT};">${b.html ?? escapeHtml(b.text)}</p>`;
  const highlight = opts.highlight
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td align="center" style="padding:18px;border:1px solid ${BORDER};border-radius:12px;background:${INK};">
        <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${MUTED};margin-bottom:6px;">${escapeHtml(opts.highlight.label)}</div>
        <div style="font-size:${opts.highlight.mono ? '32px' : '18px'};letter-spacing:${opts.highlight.mono ? '8px' : '0'};font-family:${opts.highlight.mono ? "'SFMono-Regular',Consolas,'Liberation Mono',monospace" : 'inherit'};font-weight:700;color:${GOLD};">${escapeHtml(opts.highlight.value)}</div>
      </td></tr></table>`
    : '';
  const action = opts.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:10px;background:${GOLD};">
        <a href="${escapeHtml(opts.action.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:${INK};text-decoration:none;">${escapeHtml(opts.action.label)}</a>
      </td></tr></table>
      <p style="margin:0 0 16px;font-size:12px;line-height:1.5;color:${MUTED};word-break:break-all;">Or paste this link into your browser: ${escapeHtml(opts.action.url)}</p>`
    : '';
  const [first, ...rest] = opts.blocks;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${INK};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${INK};"><tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="padding:0 4px 20px;font-size:20px;font-weight:700;letter-spacing:4px;color:${GOLD};">AUROVANE</td></tr>
    <tr><td style="padding:32px 28px;background:${SURFACE};border:1px solid ${BORDER};border-radius:16px;">
      <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:${TEXT};font-weight:700;">${escapeHtml(opts.title)}</h1>
      ${first ? para(first) : ''}
      ${highlight}
      ${action}
      ${rest.map(para).join('\n      ')}
    </td></tr>
    <tr><td style="padding:20px 4px;font-size:12px;line-height:1.6;color:${MUTED};">${escapeHtml(FOOTER_TEXT)}${support ? `<br>Questions? Contact <a href="mailto:${escapeHtml(support)}" style="color:${GOLD};">${escapeHtml(support)}</a>.` : ''}</td></tr>
  </table>
</td></tr></table>
</body></html>`;
  return { text, html };
}

export function verificationCodeEmail(to: string, code: string, purpose: 'SIGNUP' | 'EMAIL_CHANGE'): MailMessage {
  const signup = purpose === 'SIGNUP';
  const { text, html } = layout({
    title: signup ? 'Confirm your e-mail address' : 'Confirm your new e-mail address',
    preheader: `Your Aurovane code expires in ${VERIFICATION_TTL_MINUTES} minutes.`,
    blocks: [
      {
        text: signup
          ? 'Welcome to Aurovane. Enter this code to confirm your e-mail address and finish creating your account:'
          : 'Enter this code in your Aurovane account settings to confirm this as your new e-mail address:',
      },
      { text: `The code expires in ${VERIFICATION_TTL_MINUTES} minutes and works once. Never share it: Aurovane staff will never ask for it.` },
      { text: 'If you did not ask for this, ignore this e-mail; nothing changes without the code.' },
    ],
    highlight: { label: 'Verification code', value: code, mono: true },
  });
  return { to, subject: signup ? `Your Aurovane verification code: ${code}` : `Confirm your new Aurovane e-mail: ${code}`, text, html };
}

export function passwordResetEmail(to: string, link: string): MailMessage {
  const { text, html } = layout({
    title: 'Reset your password',
    preheader: 'This single-use link expires in 30 minutes.',
    blocks: [
      { text: 'Someone (hopefully you) asked to reset the password for this Aurovane account. Open the link within 30 minutes to choose a new password. It works once.' },
      { text: 'If you did not ask for this, ignore this e-mail; your password stays the same.' },
    ],
    action: { label: 'Choose a new password', url: link },
  });
  return { to, subject: 'Reset your Aurovane password', text, html };
}

export function emailChangedNotice(to: string, maskedNewAddress: string): MailMessage {
  const { text, html } = layout({
    title: 'Your e-mail address was changed',
    preheader: 'Other devices were signed out.',
    blocks: [
      { text: `The e-mail address of your Aurovane account was changed to ${maskedNewAddress}. Other devices were signed out.` },
      { text: 'If you did not make this change, reset your password and contact support straight away.' },
    ],
  });
  return { to, subject: 'Your Aurovane e-mail address was changed', text, html };
}

/** Sent by operators (admin health page or `npm run ops:mail-check`) to prove delivery. */
export function testEmail(to: string): MailMessage {
  const { text, html } = layout({
    title: 'Aurovane e-mail delivery test',
    preheader: 'If you can read this, transactional e-mail works.',
    blocks: [
      { text: `This test message was sent by ${env().APP_URL} to confirm that transactional e-mail (verification codes, password resets, security notices) is delivered.` },
      { text: 'Check that it arrived in the inbox (not spam) and that the sender domain passes SPF, DKIM and DMARC in the message headers.' },
    ],
  });
  return { to, subject: 'Aurovane e-mail delivery test', text, html };
}
