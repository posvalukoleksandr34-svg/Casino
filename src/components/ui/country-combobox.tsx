'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export interface CountryChoice {
  code: string;
  name: string;
  callingCode: string | null;
}

/** Case- and accent-insensitive key ("Côte d’Ivoire" matches "cote"). */
function fold(s: string) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Searchable country selector following the WAI-ARIA combobox pattern:
 * type to filter by name or ISO code, arrow keys to move, Enter to choose,
 * Escape to close; touch and mouse select by tapping. The stored value is the
 * ISO 3166-1 alpha-2 code.
 */
export function CountryCombobox({
  id,
  options,
  value,
  onChange,
  showCallingCode = false,
  placeholder = 'Search countries',
  invalid,
  describedBy,
  name,
}: {
  id: string;
  options: CountryChoice[];
  value: string;
  onChange: (code: string) => void;
  showCallingCode?: boolean;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  name?: string;
}) {
  const listId = useId();
  const selected = options.find((o) => o.code === value) ?? null;
  const label = (o: CountryChoice) => (showCallingCode && o.callingCode ? `${o.name} (+${o.callingCode})` : o.name);
  const [query, setQuery] = useState(selected ? label(selected) : '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Follow outside changes of the value (e.g. the phone region following the residence country).
  useEffect(() => {
    if (!open) setQuery(selected ? label(selected) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const filtered = useMemo(() => {
    const q = fold(query.trim());
    if (!q || (selected && query === label(selected))) return options;
    const digits = q.replace(/^\+/, '');
    return options.filter((o) => fold(o.name).includes(q) || o.code.toLowerCase() === q || (showCallingCode && o.callingCode !== null && /^\d+$/.test(digits) && o.callingCode.startsWith(digits)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, options, showCallingCode, selected]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (o: CountryChoice) => {
    onChange(o.code);
    setQuery(label(o));
    setOpen(false);
  };

  const close = () => {
    setOpen(false);
    setQuery(selected ? label(selected) : '');
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${listId}-${filtered[active]!.code}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={query}
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
          setActive(Math.max(0, filtered.findIndex((o) => o.code === value)));
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => setTimeout(close, 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(filtered.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            const o = filtered[active];
            if (o) choose(o);
          } else if (e.key === 'Escape') {
            close();
          } else if (e.key === 'Tab' && open && filtered.length === 1) {
            choose(filtered[0]!);
          }
        }}
        className={cn(
          'h-11 w-full rounded-xl border border-ink-600 bg-ink-900 px-3.5 pr-9 text-sm text-ink-100 placeholder:text-ink-400 hover:border-ink-500 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/25',
          invalid && 'border-negative/70',
        )}
      />
      <svg viewBox="0 0 20 20" className="pointer-events-none absolute right-3 top-3.5 size-4 text-ink-400" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {open && (
        <ul ref={listRef} id={listId} role="listbox" className="surface absolute z-30 mt-1 max-h-64 w-full overflow-y-auto overscroll-contain py-1 text-sm">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-ink-400" role="option" aria-selected={false} aria-disabled="true">
              No country matches “{query}”
            </li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o.code}
                id={`${listId}-${o.code}`}
                data-index={i}
                role="option"
                aria-selected={o.code === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                onMouseEnter={() => setActive(i)}
                className={cn('flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5', i === active ? 'bg-ink-800 text-ink-100' : 'text-ink-200', o.code === value && 'text-gold-200')}
              >
                <span>{o.name}</span>
                <span className="num shrink-0 text-xs text-ink-400">{showCallingCode && o.callingCode ? `+${o.callingCode}` : o.code}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
