import Link from 'next/link';
import { PageHeader } from '@/components/ui/misc';
import { PolicySection } from '@/components/ui/prose';
import { MINIMUM_AGE, TERMS_VERSION } from '@/lib/account-policy';

export const metadata = { title: 'Terms of Service' };

export default function TermsPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Terms of Service" subtitle={`Version ${TERMS_VERSION}. The version you accepted is recorded with your account.`} />
      <div className="surface max-w-3xl space-y-10 p-6 sm:p-10">
        <PolicySection title="1. What Aurovane is">
          <p>
            Aurovane is an entertainment platform for casino-style games and football score predictions played with free virtual chips. It is not a real-money gambling service and is not
            licensed as one.
          </p>
        </PolicySection>
        <PolicySection title="2. Virtual chips">
          <ul>
            <li>Chips are free. They cannot be bought, sold, withdrawn, exchanged for money, goods or services, or transferred between accounts.</li>
            <li>Chips have no monetary value and are not your property; balances may be adjusted to correct errors, and every adjustment is recorded in the ledger.</li>
            <li>No prize, payment or reward of value is ever offered for chips, results or achievements.</li>
          </ul>
        </PolicySection>
        <PolicySection title="3. Who may use it">
          <ul>
            <li>You must be at least {MINIMUM_AGE} years old. We ask for your date of birth and refuse accounts that do not meet this age.</li>
            <li>One account per person. Keep your password private; you are responsible for activity on your account.</li>
            <li>Your details must be truthful. You may correct them in Settings at any time.</li>
          </ul>
        </PolicySection>
        <PolicySection title="4. Fair play">
          <p>
            Game outcomes are decided on the server and can be verified with the published{' '}
            <Link href="/fairness" className="text-gold-400">
              provably fair
            </Link>{' '}
            method. Every game has a house edge, described on the{' '}
            <Link href="/rules" className="text-gold-400">
              rules pages
            </Link>
            : over time players are expected to lose chips. Do not use automation, exploit defects or interfere with the service; we may suspend accounts that do.
          </p>
        </PolicySection>
        <PolicySection title="5. Responsible play">
          <p>
            Even without money, gambling-style games can become habit-forming. Use the limits, cool-off and self-exclusion tools under{' '}
            <Link href="/responsible-play" className="text-gold-400">
              Responsible play
            </Link>
            ; the server enforces them before any wager is accepted.
          </p>
        </PolicySection>
        <PolicySection title="6. Your account">
          <p>
            You can export your data or delete your account from Settings. We may suspend or close an account that breaks these terms. The service is provided as is and may change, pause or end.
          </p>
        </PolicySection>
        <PolicySection title="7. Changes">
          <p>When these terms change in substance we publish a new version here with a new date; the version you accepted stays recorded with your account.</p>
        </PolicySection>
        <p className="text-xs text-ink-400">
          This is the operator&apos;s plain-language statement of how the service works. It has not been reviewed for compliance with the laws of any particular country; an operator deploying
          Aurovane publicly should have it reviewed.
        </p>
      </div>
    </>
  );
}
