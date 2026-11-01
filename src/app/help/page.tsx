import Link from 'next/link';
import { PageHeader } from '@/components/ui/misc';
import { PolicySection } from '@/components/ui/prose';
import { MINIMUM_AGE, VERIFICATION_TTL_MINUTES } from '@/lib/account-policy';
import { supportEmail } from '@/server/env';

export const metadata = { title: 'Help & support' };

/** Plain answers to what a new visitor needs to know, and how to reach support. */
export default function HelpPage() {
  const support = supportEmail();
  return (
    <>
      <PageHeader eyebrow="Help" title="How Aurovane works" subtitle="A free social casino with published rules and verifiable outcomes. Here is what that means in practice." />
      <div className="surface max-w-3xl space-y-10 p-6 sm:p-10">
        <PolicySection id="free" title="Free to play, with virtual chips">
          <ul>
            <li>Aurovane is free. There are no deposits, no withdrawals, no purchases and no payment details — ever.</li>
            <li>Chips are virtual. They have no monetary value and cannot be bought, sold, transferred to another player, withdrawn or exchanged for money, goods or services.</li>
            <li>You receive free welcome chips when your account is activated, and you can claim free daily chips (unless you have chosen a break from play).</li>
            <li>Aurovane is not a real-money casino and is not licensed as one. There are no prizes of value.</li>
          </ul>
        </PolicySection>
        <PolicySection id="account" title="Creating an account">
          <ol className="ml-5 list-decimal space-y-1.5">
            <li>Choose a username, enter your e-mail address and a password, and confirm that you are at least {MINIMUM_AGE}.</li>
            <li>Enter the six-digit code we e-mail you (it expires after {VERIFICATION_TTL_MINUTES} minutes; you can request a new one).</li>
            <li>Add a few details — your name, date of birth, country and phone number — which are never shown to other players.</li>
            <li>Enter the lobby. Your chips and history are in your wallet and profile.</li>
          </ol>
        </PolicySection>
        <PolicySection id="odds" title="Rules, odds and fairness">
          <p>
            Every game publishes its rules, probabilities, payouts and theoretical return to player on the{' '}
            <Link href="/rules" className="text-gold-400">
              rules pages
            </Link>
            . Every game has a house edge: over time, players are expected to lose chips, and short-term results vary widely.
          </p>
          <p>
            Outcomes are decided on the server from a secret seed whose SHA-256 commitment you see before you play. When you rotate the seed, it is revealed and you can recompute any
            past result yourself — see{' '}
            <Link href="/fairness" className="text-gold-400">
              Provably fair
            </Link>
            .
          </p>
        </PolicySection>
        <PolicySection id="responsible" title="Staying in control">
          <p>
            Even without money, casino-style games can be habit-forming. Under{' '}
            <Link href="/responsible-play" className="text-gold-400">
              Responsible play
            </Link>{' '}
            you can set loss, wager and session limits, take a cool-off break or exclude yourself. The server enforces them before any game round or prediction, loosening a limit takes
            effect only after a delay, and an active break is shown on every page.
          </p>
        </PolicySection>
        <PolicySection id="support" title="Support and privacy requests">
          {support ? (
            <p>
              E-mail{' '}
              <a href={`mailto:${support}`} className="text-gold-400">
                {support}
              </a>{' '}
              for help with your account, a problem with a game, or a privacy request (access, correction, deletion). Staff will never ask for your password or a verification code.
            </p>
          ) : (
            <p>The operator of this site has not published a support address yet.</p>
          )}
          <p>
            You can also export your data or delete your account yourself in{' '}
            <Link href="/settings" className="text-gold-400">
              Settings
            </Link>
            . See the{' '}
            <Link href="/terms" className="text-gold-400">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-gold-400">
              Privacy Notice
            </Link>
            .
          </p>
        </PolicySection>
      </div>
    </>
  );
}
