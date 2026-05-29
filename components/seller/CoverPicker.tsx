'use client';

import { Check } from 'lucide-react';
import { COVER_PRESETS } from '@/lib/store-customization';

interface Props {
  value?: string;
  onChange: (key: string) => void;
}

/** Selettore gradiente cover — usato quando il negozio non ha foto/video. */
export default function CoverPicker({ value, onChange }: Props) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink-700 mb-2">Sfondo cover (senza foto)</label>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {COVER_PRESETS.map((p) => {
          const selected = value === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(p.key)}
              title={p.label}
              aria-label={p.label}
              aria-pressed={selected}
              className={`relative h-12 rounded-lg overflow-hidden ${p.className} focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-ink-300 ${
                selected ? 'ring-2 ring-offset-1 ring-ink-500' : 'ring-1 ring-cream-300'
              }`}
            >
              {selected && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/15">
                  <Check size={16} strokeWidth={3} className="text-white" aria-hidden />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-500 mt-2">Usato solo se non carichi foto o video di copertina.</p>
    </div>
  );
}
