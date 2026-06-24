'use client';

import { useEffect, useState } from 'react';
import { MapPin, ChevronDown, X } from 'lucide-react';
import { useLocalStorage } from '@/lib/hooks';

const STORAGE_KEY = 'mc_delivery_location';

type Location = { city: string; zip: string };
const DEFAULT_LOC: Location = { city: 'Piacenza', zip: '29121' };

/**
 * Pill "Consegna a Piacenza 29100" cliccabile per cambiare CAP.
 * In MVP supportiamo solo Piacenza (e provincia, raccontata via CAP), ma il
 * componente è pronto per altre città quando espanderemo.
 */
export default function LocationPill({ compact = false }: { compact?: boolean }) {
  const [loc, setLoc] = useLocalStorage<Location>(STORAGE_KEY, DEFAULT_LOC);
  const [open, setOpen] = useState(false);
  const [zip, setZip] = useState(loc.zip);

  useEffect(() => {
    setZip(loc.zip);
  }, [loc.zip]);

  const save = () => {
    const cleaned = zip.replace(/\D/g, '').slice(0, 5);
    if (cleaned.length !== 5) return;
    const newLoc: Location = { city: cleaned.startsWith('291') ? 'Piacenza' : loc.city, zip: cleaned };
    setLoc(newLoc);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mc:location-change', { detail: newLoc }));
    }
    setOpen(false);
  };

  // Prompt gentile, non bloccante: una volta sola suggeriamo di inserire
  // l'indirizzo per vedere la disponibilità "oggi". Chiudibile e ricordato.
  const [hint, setHint] = useState(false);
  const dismissHint = () => {
    setHint(false);
    try { localStorage.setItem('mc_addr_hint', '1'); } catch { /* ignore */ }
  };
  useEffect(() => {
    if (compact || typeof window === 'undefined') return;
    if (localStorage.getItem('mc_addr_hint') === '1') return;
    const t = setTimeout(() => setHint(true), 1400);
    return () => clearTimeout(t);
  }, [compact]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); dismissHint(); }}
        className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-2.5 py-1.5 rounded-full text-xs font-medium ring-1 ring-white/15 transition-colors focus-visible:outline-white"
        title="Cambia indirizzo di consegna"
      >
        <MapPin size={14} strokeWidth={2.2} className="text-accent-300" />
        {compact ? (
          <span>{loc.zip}</span>
        ) : (
          <>
            <span className="hidden sm:inline opacity-70">Consegna a</span>
            <span className="font-semibold">{loc.city}</span>
            <span className="opacity-70">{loc.zip}</span>
          </>
        )}
        <ChevronDown size={12} strokeWidth={2.4} className="opacity-70" />
      </button>

      {hint && !open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-64 rounded-xl bg-white p-3 text-ink-900 shadow-warm-lg ring-1 ring-cream-300">
          <button type="button" onClick={dismissHint} aria-label="Chiudi" className="absolute right-2 top-2 text-ink-300 hover:text-ink-600">
            <X size={14} strokeWidth={2.4} />
          </button>
          <p className="pr-4 text-sm font-semibold inline-flex items-center gap-1.5"><MapPin size={16} strokeWidth={2.2} className="text-primary-600 shrink-0" aria-hidden /> Dove ti consegniamo?</p>
          <p className="mt-1 text-xs text-ink-500">Inserisci il tuo indirizzo per vedere cosa puoi ricevere <strong>oggi</strong>.</p>
          <button
            type="button"
            onClick={() => { dismissHint(); setOpen(true); }}
            className="mt-2 w-full rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700"
          >
            Inserisci indirizzo
          </button>
        </div>
      )}

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute left-0 top-full mt-2 w-72 bg-white rounded-xl shadow-warm-lg ring-1 ring-ink-100 p-4 z-50 text-ink-900">
            <p className="text-sm font-semibold mb-1">Dove vuoi ricevere?</p>
            <p className="text-xs text-ink-500 mb-3">
              Mostriamo i negozi che consegnano al tuo CAP.
            </p>
            <input
              type="text"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              maxLength={5}
              inputMode="numeric"
              pattern="[0-9]{5}"
              placeholder="29121"
              className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            <button
              onClick={save}
              disabled={zip.replace(/\D/g, '').length !== 5}
              className="mt-3 w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              Aggiorna posizione
            </button>
            <p className="text-[11px] text-ink-400 mt-2 text-center">
              In MVP serviamo Piacenza e provincia.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
