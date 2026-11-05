'use client';

import { Clock } from 'lucide-react';
import { formatToday, isOpenNow, DAY_KEYS, type StoreHours } from '@/lib/store-hours';
import type { SectionContext } from './SectionContext';

const DAYS: { key: keyof StoreHours; label: string }[] = [
  { key: 'mon', label: 'Lunedì' },
  { key: 'tue', label: 'Martedì' },
  { key: 'wed', label: 'Mercoledì' },
  { key: 'thu', label: 'Giovedì' },
  { key: 'fri', label: 'Venerdì' },
  { key: 'sat', label: 'Sabato' },
  { key: 'sun', label: 'Domenica' },
];

/**
 * Card "Orari di apertura" con righe per giorno e titolo serif.
 * Pensata per stare nella colonna sinistra della tab "Info & orari" affiancata
 * alla card Contatti ("Dove siamo"). Non renderizza se non ci sono orari.
 */
export default function HoursSection({ ctx }: { ctx: SectionContext }) {
  const hours = (ctx.store.store_hours ?? {}) as StoreHours;
  const hasHours = DAYS.some((d) => Array.isArray(hours[d.key]));
  if (!hasHours) return null;

  const todayKey = DAY_KEYS[new Date().getDay()];
  const todayIntervals = hours[todayKey] ?? [];
  const openNow = isOpenNow(todayIntervals);
  const todayLabel = formatToday(todayIntervals);

  return (
    <section className="rounded-2xl border border-cream-300 bg-white p-6 shadow-warm-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-serif text-lg font-bold text-ink-900">
          <Clock size={18} className="text-accent-600" aria-hidden />
          Orari di apertura
        </h2>
        <span className={`text-sm font-medium ${openNow ? 'text-olive-700' : 'text-ink-500'}`}>
          {openNow ? 'Aperto ora' : todayLabel}
        </span>
      </div>
      <ul className="divide-y divide-cream-100">
        {DAYS.map((d) => {
          const intervals = hours[d.key];
          const closed = !intervals || intervals.length === 0;
          const isToday = d.key === todayKey;
          return (
            <li
              key={d.key}
              className={`flex items-center justify-between py-2.5 text-sm ${
                isToday ? 'font-semibold text-ink-900' : 'text-ink-700'
              }`}
            >
              <span className="flex items-center gap-2">
                {d.label}
                {isToday && (
                  <span className="rounded bg-primary-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary-700">
                    Oggi
                  </span>
                )}
              </span>
              <span className={closed ? 'text-ink-400' : ''}>
                {closed ? 'Chiuso' : intervals.map(([o, c]) => `${o} – ${c}`).join(' · ')}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
