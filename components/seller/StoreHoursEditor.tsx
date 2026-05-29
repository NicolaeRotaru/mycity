'use client';

import { Plus, X } from 'lucide-react';
import type { StoreHours, HoursInterval } from '@/lib/store-hours';

const DAYS: { key: keyof StoreHours; label: string }[] = [
  { key: 'mon', label: 'Lunedì' },
  { key: 'tue', label: 'Martedì' },
  { key: 'wed', label: 'Mercoledì' },
  { key: 'thu', label: 'Giovedì' },
  { key: 'fri', label: 'Venerdì' },
  { key: 'sat', label: 'Sabato' },
  { key: 'sun', label: 'Domenica' },
];

interface Props {
  value: StoreHours;
  onChange: (next: StoreHours) => void;
}

/** Editor visuale degli orari di apertura (più fasce/giorno per la pausa pranzo). */
export default function StoreHoursEditor({ value, onChange }: Props) {
  const setDay = (key: keyof StoreHours, intervals: HoursInterval[]) => {
    onChange({ ...value, [key]: intervals });
  };
  const addInterval = (key: keyof StoreHours) => {
    setDay(key, [...(value[key] ?? []), ['09:00', '13:00']]);
  };
  const removeInterval = (key: keyof StoreHours, idx: number) => {
    setDay(key, (value[key] ?? []).filter((_, i) => i !== idx));
  };
  const setTime = (key: keyof StoreHours, idx: number, pos: 0 | 1, time: string) => {
    const cur = (value[key] ?? []).map((iv) => [...iv] as HoursInterval);
    if (!cur[idx]) return;
    cur[idx][pos] = time;
    setDay(key, cur);
  };

  return (
    <div className="space-y-1">
      {DAYS.map((d) => {
        const intervals = value[d.key] ?? [];
        const closed = intervals.length === 0;
        return (
          <div key={d.key} className="flex flex-wrap items-center gap-2 py-2 border-b border-cream-100 last:border-0">
            <span className="w-24 text-sm font-medium text-ink-700 shrink-0">{d.label}</span>
            {closed ? (
              <span className="text-sm text-ink-400 flex-1">Chiuso</span>
            ) : (
              <div className="flex flex-wrap items-center gap-2 flex-1">
                {intervals.map((iv, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 bg-cream-50 border border-cream-200 rounded-lg px-2 py-1">
                    <input
                      type="time"
                      value={iv[0]}
                      onChange={(e) => setTime(d.key, idx, 0, e.target.value)}
                      aria-label={`${d.label} apertura`}
                      className="text-sm bg-transparent focus:outline-none"
                    />
                    <span className="text-ink-400">–</span>
                    <input
                      type="time"
                      value={iv[1]}
                      onChange={(e) => setTime(d.key, idx, 1, e.target.value)}
                      aria-label={`${d.label} chiusura`}
                      className="text-sm bg-transparent focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeInterval(d.key, idx)}
                      aria-label="Rimuovi orario"
                      className="text-ink-400 hover:text-rose-600 ml-0.5"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => addInterval(d.key)}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:text-primary-800"
              >
                <Plus size={14} /> orario
              </button>
              {!closed && (
                <button
                  type="button"
                  onClick={() => setDay(d.key, [])}
                  className="text-xs text-ink-400 hover:text-rose-600"
                >
                  Chiudi
                </button>
              )}
            </div>
          </div>
        );
      })}
      <p className="text-xs text-ink-500 pt-2">Aggiungi più fasce per la pausa pranzo. &quot;Chiudi&quot; segna il giorno come chiuso.</p>
    </div>
  );
}
