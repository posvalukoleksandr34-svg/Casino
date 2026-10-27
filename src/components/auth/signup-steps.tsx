import { cn } from '@/lib/cn';

export const SIGNUP_STEPS = ['Create account', 'Verify e-mail', 'Your details', 'Enter the lobby'] as const;

/** Progress through registration: numbered steps, the current one marked for assistive technology. */
export function SignupSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <nav aria-label="Registration progress" className="mb-8">
      <p className="sr-only">
        Step {current} of {SIGNUP_STEPS.length}: {SIGNUP_STEPS[current - 1]}
      </p>
      <ol className="grid grid-cols-4 gap-2">
        {SIGNUP_STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < current ? 'done' : n === current ? 'current' : 'todo';
          return (
            <li key={label} aria-current={state === 'current' ? 'step' : undefined} className="flex flex-col items-center gap-2 text-center">
              <span className="flex w-full items-center">
                <span className={cn('h-px flex-1', i === 0 ? 'bg-transparent' : n <= current ? 'bg-gold-600' : 'bg-ink-700')} />
                <span
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                    state === 'done' && 'border-gold-600 bg-gold-600/20 text-gold-200',
                    state === 'current' && 'border-gold-400 bg-gradient-to-b from-gold-400 to-gold-600 text-ink-950 shadow-[0_0_0_4px_rgb(199_163_91/0.15)]',
                    state === 'todo' && 'border-ink-600 bg-ink-900 text-ink-400',
                  )}
                >
                  {state === 'done' ? (
                    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    n
                  )}
                  <span className="sr-only">{state === 'done' ? ' (completed)' : ''}</span>
                </span>
                <span className={cn('h-px flex-1', i === SIGNUP_STEPS.length - 1 ? 'bg-transparent' : n < current ? 'bg-gold-600' : 'bg-ink-700')} />
              </span>
              <span className={cn('text-[11px] leading-tight sm:text-xs', state === 'current' ? 'font-semibold text-gold-200' : state === 'done' ? 'text-ink-300' : 'text-ink-400')}>{label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
