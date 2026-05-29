'use client';

import { Check } from 'lucide-react';
import { ACCENT_PRESETS } from '@/lib/store-customization';

interface Props {
  value?: string;
  onChange: (hex: string) => void;
}

/** Selettore colore brand — palette curata (modalità coerente/premium). */
export default function AccentPicker({ value, onChange }: Props) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink-700 mb-2">Colore del negozio</label>
      <div className="flex flex-wrap gap-2.5">
        {ACCENT_PRESETS.map((p) => {
          const selected = value === p.hex;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(p.hex)}
              title={p.label}
              aria-label={p.label}
              aria-pressed={selected}
              className={`relative w-9 h-9 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ink-300 ${
                selected ? 'ring-2 ring-offset-2 ring-ink-400' : ''
              }`}
              style={{ backgroundColor: p.hex }}
            >
              {selected && <Check size={16} strokeWidth={3} className="absolute inset-0 m-auto text-white" aria-hidden />}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-500 mt-2">Tinge intestazione, badge e pulsanti della tua vetrina.</p>
    </div>
  );
}
