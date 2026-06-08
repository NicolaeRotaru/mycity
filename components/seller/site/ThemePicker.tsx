'use client';

import { Check } from 'lucide-react';
import { THEME_PRESETS, type ThemeKey } from '@/lib/store-site';

/** Scelta del tema/look del sito (catalogo chiuso, sul modello di CoverPicker). */
export default function ThemePicker({ value, onChange }: { value: ThemeKey; onChange: (t: ThemeKey) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {THEME_PRESETS.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            aria-pressed={active}
            className={`text-left rounded-xl border p-3 transition-all ${
              active
                ? 'border-primary-500 ring-2 ring-primary-200 bg-primary-50/40'
                : 'border-cream-300 hover:border-cream-400 bg-white'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ink-900 text-sm">{t.label}</span>
              {active && <Check size={16} className="text-primary-600 shrink-0" aria-hidden />}
            </div>
            <p className="text-xs text-ink-500 mt-0.5">{t.description}</p>
          </button>
        );
      })}
    </div>
  );
}
