'use client';

import { Clock, ChevronDown } from 'lucide-react';
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

/** Orari di apertura (collassati di default) con badge "aperto ora". */
export default function HoursSection({ ctx }: { ctx: SectionContext }) {
  const hours = (ctx.store.store_hours ?? {}) as StoreHours;
  const hasHours = DAYS.some((d) => Array.isArray(hours[d.key]));
  if (!hasHours) return null;

  const todayKey = DAY_KEYS[new Date().getDay()];
  const todayIntervals = hours[todayKey] ?? [];
  const openNow = isOpenNow(todayIntervals);
  const todayLabel = formatToday(todayIntervals);

  return (
    <details className="group bg-white border border-cream-300 rounded-2xl overflow-hidden">
      <summary className="flex items-center justify-between gap-3 cursor-pointer list-none px-6 py-4 hover:bg-cream-50 transition-colors">
        <h2 className="font-semibold text-lg text-ink-900 flex items-center gap-2">
          <Clock size={18} className="text-accent-600" aria-hidden />
          Orari di apertura
        </h2>
        <span className="flex items-center gap-2 text-sm text-ink-500">
          <span className={`font-medium ${openNow ? 'text-olive-700' : 'text-ink-500'}`}>
            {openNow ? 'Aperto ora' : todayLabel}
          </span>
          <ChevronDown size={18} className="transition-transform group-open:rotate-180" aria-hidden />
        </span>
      </summary>
      <ul className="divide-y divide-cream-100 px-6 pb-5">
        {DAYS.map((d) => {
          const intervals = hours[d.key];
          const closed = !intervals || intervals.length === 0;
          const isToday = d.key === todayKey;
          return (
            <li
              key={d.key}
              className={`flex justify-between items-center py-2.5 text-sm ${
                isToday ? 'font-semibold text-ink-900' : 'text-ink-700'
              }`}
            >
              <span className="flex items-center gap-2">
                {d.label}
                {isToday && (
                  <span className="text-[10px] uppercase tracking-wider bg-primary-50 text-primary-700 px-1.5 py-0.5 rounded">
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
    </details>
  );
}
