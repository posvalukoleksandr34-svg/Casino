import Link from 'next/link';
import { PageHeader } from '@/components/ui/misc';
import { PolicySection } from '@/components/ui/prose';
import { PRIVACY_VERSION, VERIFICATION_TTL_MINUTES } from '@/lib/account-policy';

export const metadata = { title: 'Privacy Notice' };

export default function PrivacyPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Privacy Notice" subtitle={`Version ${PRIVACY_VERSION}. What we collect, why, and what you can do about it.`} />
      <div className="surface max-w-3xl space-y-10 p-6 sm:p-10">
        <PolicySection title="What we collect">
          <ul>
            <li>
              <strong className="text-ink-100">Account:</strong> username, e-mail address, a salted password hash (never the password), and when you accepted these terms.
            </li>
            <li>
              <strong className="text-ink-100">E-mail verification:</strong> when each six-digit code was sent, to which address, and whether it was used. Codes themselves are not stored — only a
              keyed fingerprint that expires after {VERIFICATION_TTL_MINUTES} minutes.
            </li>
            <li>
              <strong className="text-ink-100">Your details:</strong> first and last name, date of birth, country of residence and phone number, which you give after confirming your e-mail.
              The phone number is not verified and is never shown as verified.
            </li>
            <li>
              <strong className="text-ink-100">Play:</strong> game rounds, predictions, the chip ledger, limits you set, achievements and favourites.
            </li>
            <li>
              <strong className="text-ink-100">Security:</strong> sessions (a hash of the session token, your browser&apos;s user-agent and a keyed hash of your IP address) and a log of
              security-relevant events such as sign-ins and settings changes. Logs record which fields changed, not your names, birth date or phone number.
            </li>
          </ul>
        </PolicySection>
        <PolicySection title="Why">
          <ul>
            <li>To run your account and the games, and to keep the chip ledger accurate and auditable.</li>
            <li>To confirm you control your e-mail address and that you meet the minimum age.</li>
            <li>To help support confirm that an account is yours, and to protect the service against abuse.</li>
          </ul>
          <p>We do not sell your data, show advertising, use third-party analytics or send marketing messages. We do not infer your country from your connection.</p>
        </PolicySection>
        <PolicySection title="Who else sees it">
          <p>
            E-mails (verification codes, password resets, security notices) are delivered through the e-mail provider the operator configures. Authorised staff can see account details needed
            for support and safety; e-mail addresses are masked for roles that do not need them, and staff actions are recorded in an audit log.
          </p>
        </PolicySection>
        <PolicySection title="Your choices">
          <ul>
            <li>Review and correct your details, change your e-mail address (confirmed with a code sent to the new address) and change your password in Settings.</li>
            <li>Download everything we hold about you as JSON from Settings.</li>
            <li>
              Delete your account from Settings. Your name, date of birth, country, phone number, e-mail, username, password and preferences are erased. The chip ledger, game and prediction
              records and the audit log are kept in pseudonymised form, because they must stay reconcilable.
            </li>
          </ul>
          <p>
            See also{' '}
            <Link href="/terms" className="text-gold-400">
              Terms of Service
            </Link>
            .
          </p>
        </PolicySection>
        <p className="text-xs text-ink-400">
          This notice describes how this software handles data. It has not been reviewed against the data-protection law of any particular country; an operator deploying Aurovane publicly is
          responsible for its own legal review, contact details and retention policy.
        </p>
      </div>
    </>
  );
}
