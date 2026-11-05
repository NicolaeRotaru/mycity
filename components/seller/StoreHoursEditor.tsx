'use client';

import { Plus, X } from 'lucide-react';
import { orariImpostati, type StoreHours, type HoursInterval } from '@/lib/store-hours';
import { DAYS, erroreDelleFasce, prossimaFascia } from './orari-validi';

export { erroreDegliOrari, erroreDelleFasce, prossimaFascia } from './orari-validi';


interface Props {
  value: StoreHours;
  onChange: (next: StoreHours) => void;
}

/** Editor visuale degli orari di apertura (più fasce/giorno per la pausa pranzo). */
export default function StoreHoursEditor({ value, onChange }: Props) {
  // 31/10/2026 — Si scrive sempre la settimana intera: un giorno mai toccato diventa «chiuso» (lista
  // vuota), come lo mostra già questo editor. Prima restava assente, e chi chiudeva tutti i giorni
  // per le ferie salvava una settimana a metà, che il sito leggeva «orari mai impostati» = sempre aperto.
  const setDay = (key: keyof StoreHours, intervals: HoursInterval[]) => {
    const settimana: StoreHours = {};
    for (const d of DAYS) settimana[d.key] = value[d.key] ?? [];
    onChange({ ...value, ...settimana, [key]: intervals });
  };
  const addInterval = (key: keyof StoreHours) => {
    setDay(key, [...(value[key] ?? []), prossimaFascia(value[key])]);
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

  // 2459 — Orari mai impostati: il sito accetta ordini a ogni ora, quindi i giorni non
  // si chiamano «Chiuso» (sarebbe il contrario di quello che vede il cliente).
  const maiImpostati = orariImpostati(value) === null;
  return (
    <div className="space-y-1">
      {maiImpostati && (
        <p role="note" className="mb-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-xs text-accent-900">
          Orari non ancora impostati: per ora il negozio riceve ordini a qualunque ora. Aggiungi le fasce di apertura qui sotto.
        </p>
      )}
      {DAYS.map((d) => {
        const intervals = value[d.key] ?? [];
        const closed = intervals.length === 0;
        const errore = erroreDelleFasce(intervals);
        return (
          <div key={d.key} className="flex flex-wrap items-center gap-2 py-2 border-b border-cream-100 last:border-0">
            <span className="w-24 text-sm font-medium text-ink-700 shrink-0">{d.label}</span>
            {closed ? (
              <span className="text-sm text-ink-400 flex-1">{maiImpostati ? 'Non impostato' : 'Chiuso'}</span>
            ) : (
              <div className="flex flex-wrap items-center gap-2 flex-1">
                {intervals.map((iv, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 bg-cream-50 border border-cream-200 rounded-lg px-2 py-1">
                    <input
                      type="time"
                      value={iv[0]}
                      onChange={(e) => setTime(d.key, idx, 0, e.target.value)}
                      aria-label={`${d.label} apertura`}
                      className="text-sm bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 rounded"
                    />
                    <span className="text-ink-400">–</span>
                    <input
                      type="time"
                      value={iv[1]}
                      onChange={(e) => setTime(d.key, idx, 1, e.target.value)}
                      aria-label={`${d.label} chiusura`}
                      className="text-sm bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 rounded"
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
            {errore && <p role="alert" className="w-full text-xs font-medium text-secondary-600">{errore}</p>}
          </div>
        );
      })}
      <p className="text-xs text-ink-500 pt-2">Aggiungi più fasce per la pausa pranzo. &quot;Chiudi&quot; segna il giorno come chiuso.</p>
    </div>
  );
}
