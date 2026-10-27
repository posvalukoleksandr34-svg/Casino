'use client';

import { AVATAR_PRESETS } from '@/lib/avatars';
import { cn } from '@/lib/cn';
import { Avatar } from './avatar';

/** Built-in avatar presets (no uploads), used by the profile editor and onboarding. */
export function AvatarPicker({ value, onChange, name }: { value: string | null; onChange: (id: string | null) => void; name: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Avatar</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Avatar">
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          aria-label="Initials (no avatar)"
          onClick={() => onChange(null)}
          className={cn('rounded-2xl border-2 p-1', value === null ? 'border-gold-400' : 'border-transparent hover:border-ink-500')}
        >
          <Avatar avatar={null} name={name} className="size-12" />
        </button>
        {AVATAR_PRESETS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={value === a.id}
            aria-label={a.label}
            title={a.label}
            onClick={() => onChange(a.id)}
            className={cn('rounded-2xl border-2 p-1', value === a.id ? 'border-gold-400' : 'border-transparent hover:border-ink-500')}
          >
            <Avatar avatar={a.id} name={name} className="size-12" />
          </button>
        ))}
      </div>
    </fieldset>
  );
}
