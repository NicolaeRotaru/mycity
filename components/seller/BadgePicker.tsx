'use client';

import { Check } from 'lucide-react';
import { BADGE_CATALOG, MAX_BADGES } from '@/lib/store-customization';

interface Props {
  value?: string[];
  onChange: (next: string[]) => void;
}

/** Multi-select dei badge "punti di forza" (catalogo chiuso, max MAX_BADGES). */
export default function BadgePicker({ value = [], onChange }: Props) {
  const toggle = (key: string) => {
    if (value.includes(key)) onChange(value.filter((k) => k !== key));
    else if (value.length < MAX_BADGES) onChange([...value, key]);
  };

  return (
    <div>
      <label className="block text-sm font-medium text-ink-700 mb-2">Punti di forza (max {MAX_BADGES})</label>
      <div className="flex flex-wrap gap-2">
        {BADGE_CATALOG.map((b) => {
          const selected = value.includes(b.key);
          const disabled = !selected && value.length >= MAX_BADGES;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => toggle(b.key)}
              disabled={disabled}
              aria-pressed={selected}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                selected
                  ? 'bg-primary-600 border-primary-600 text-white'
                  : 'bg-white border-cream-300 text-ink-700 hover:border-primary-300'
              } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {selected && <Check size={14} strokeWidth={3} aria-hidden />}
              {b.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
