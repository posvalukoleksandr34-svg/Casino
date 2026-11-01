import Link from 'next/link';
import { PageHeader } from '@/components/ui/misc';
import { PolicySection } from '@/components/ui/prose';
import { PRIVACY_VERSION, VERIFICATION_TTL_MINUTES } from '@/lib/account-policy';
import { supportEmail } from '@/server/env';

export const metadata = { title: 'Privacy Notice' };

export default function PrivacyPage() {
  const support = supportEmail();
  return (
    <>
      <PageHeader eyebrow="Legal" title="Privacy Notice" subtitle={`Version ${PRIVACY_VERSION}. What we collect, why, how long we keep it, and what you can do about it.`} />
      <div className="surface max-w-3xl space-y-10 p-6 sm:p-10">
        <PolicySection title="What we collect">
          <ul>
            <li>
              <strong className="text-ink-100">Account:</strong> username, e-mail address, a salted password hash (never the password), the versions of these terms and this notice you
              accepted, and when.
            </li>
            <li>
              <strong className="text-ink-100">E-mail verification:</strong> when each six-digit code was sent, to which address, whether it arrived and whether it was used. Codes themselves
              are not stored — only a keyed fingerprint that expires after {VERIFICATION_TTL_MINUTES} minutes.
            </li>
            <li>
              <strong className="text-ink-100">Your details:</strong> first and last name, date of birth, country of residence and phone number, which you give after confirming your e-mail.
              The phone number is shown as unverified unless it was confirmed by a code sent by text message (offered only where the operator has set up an SMS provider).
            </li>
            <li>
              <strong className="text-ink-100">Play:</strong> game rounds, sports predictions, the virtual-chip ledger, limits and breaks you set, achievements and favourites.
            </li>
            <li>
              <strong className="text-ink-100">Security:</strong> sessions (a hash of the session token, your browser&apos;s user-agent and a keyed hash of your IP address) and a log of
              security-relevant events such as sign-ins and settings changes. Logs record which fields changed, not your names, birth date or phone number. Two-factor authentication, if you
              turn it on, stores an encrypted secret and hashed recovery codes.
            </li>
          </ul>
        </PolicySection>
        <PolicySection title="Why">
          <ul>
            <li>To run your account and the games, and to keep the chip ledger accurate and auditable.</li>
            <li>To confirm you control your e-mail address and that you meet the minimum age.</li>
            <li>To help support confirm that an account is yours, and to protect the service and its players against abuse.</li>
            <li>To apply the responsible-play limits and breaks you choose.</li>
          </ul>
          <p>We do not sell your data, show advertising, use third-party analytics or tracking, or send marketing messages. We do not infer your country from your connection.</p>
        </PolicySection>
        <PolicySection title="Cookies and browser storage">
          <ul>
            <li>
              <strong className="text-ink-100">Session cookie</strong> (HttpOnly, SameSite=Lax, Secure on HTTPS): keeps you signed in; it ends when you sign out, after a period of inactivity or
              at the latest after a fixed lifetime.
            </li>
            <li>
              <strong className="text-ink-100">Sign-up cookie</strong> (HttpOnly): links this browser to a registration that is waiting for its e-mail code; valid 24 hours.
            </li>
            <li>Session storage in your browser remembers an unfinished game request so it can be recovered safely after a lost connection; it is cleared when the tab closes.</li>
          </ul>
          <p>No advertising, analytics or third-party cookies are used.</p>
        </PolicySection>
        <PolicySection title="Who else processes it">
          <ul>
            <li>The hosting and database infrastructure the operator runs Aurovane on.</li>
            <li>The e-mail provider the operator configures, which delivers verification codes, password-reset links and security notices to your address.</li>
            <li>An SMS provider, only if the operator configures one for phone verification; it receives your number and the code.</li>
          </ul>
          <p>
            When live sports data is enabled, the sports data providers receive requests from our server only; no personal data is sent to them. Authorised staff can see the account details
            needed for support and safety; e-mail addresses are masked for roles that do not need them, and staff actions are recorded in an audit log.
          </p>
        </PolicySection>
        <PolicySection title="How long we keep it">
          <ul>
            <li>Sessions expire after inactivity and a maximum lifetime; their records are deleted 30 days after they expire.</li>
            <li>A registration that is never confirmed can be released after 24 hours, which erases it as described under deletion.</li>
            <li>
              When you delete your account, your name, date of birth, country, phone number, e-mail address, username, password and preferences are erased straight away, together with the
              addresses and numbers verification codes were sent to.
            </li>
            <li>
              The chip ledger, game and prediction records and the audit log are kept, pseudonymised, for as long as the service runs, because they must stay reconcilable and auditable.
            </li>
            <li>Encrypted database backups are kept for a limited period set by the operator (35 days by default); deleted data disappears from backups as they expire.</li>
          </ul>
        </PolicySection>
        <PolicySection title="Your choices and requests">
          <ul>
            <li>Review and correct your details, change your e-mail address (confirmed with a code sent to the new address) and change your password in Settings.</li>
            <li>Download everything we hold about you as JSON from Settings.</li>
            <li>Delete your account from Settings, as described above.</li>
          </ul>
          {support ? (
            <p>
              For any other privacy question or request, write to{' '}
              <a href={`mailto:${support}`} className="text-gold-400">
                {support}
              </a>
              . We may ask you to confirm the request from your account&apos;s e-mail address.
            </p>
          ) : (
            <p>The operator of this site has not published a contact address yet.</p>
          )}
          <p>
            See also{' '}
            <Link href="/terms" className="text-gold-400">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/help" className="text-gold-400">
              Help & support
            </Link>
            .
          </p>
        </PolicySection>
        <p className="text-xs text-ink-400">
          This notice describes how this software handles data. It has not been reviewed against the data-protection law of any country (for example the Swiss Federal Act on Data Protection
          or the EU GDPR); the operator deploying Aurovane publicly is responsible for its own legal review, identity and contact details, legal bases and retention policy.
        </p>
      </div>
    </>
  );
}
