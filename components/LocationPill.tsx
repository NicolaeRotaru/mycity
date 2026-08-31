'use client';

import { useEffect, useId, useRef, useState } from 'react';
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

  // 27/8/2026 (R113) — la pillola apriva un pannello senza dirlo e senza uscita
  // da tastiera: nel file non esisteva un solo gestore di tasti, e per chiudere
  // bisognava cliccare fuori col mouse. Qui il pannello si presenta (è un
  // dialogo, ha un nome), Esc lo chiude, e il fuoco entra e poi torna indietro.
  const pillolaRef = useRef<HTMLButtonElement>(null);
  const capRef = useRef<HTMLInputElement>(null);
  const idTitolo = useId();

  const chiudi = (tornaAllaPillola = true) => {
    setOpen(false);
    if (tornaAllaPillola) pillolaRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    capRef.current?.focus();
    const suTasto = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      pillolaRef.current?.focus();
    };
    document.addEventListener('keydown', suTasto);
    return () => document.removeEventListener('keydown', suTasto);
  }, [open]);

  useEffect(() => {
    setZip(loc.zip);
  }, [loc.zip]);

  // 22/8/2026 — il salvataggio usciva in silenzio su un CAP incompleto: la
  // persona premeva «Salva», il riquadro restava lì, e nessuno le diceva cosa
  // c'era di sbagliato.
  const [erroreCap, setErroreCap] = useState<string | null>(null);

  const save = () => {
    const cleaned = zip.replace(/\D/g, '').slice(0, 5);
    if (cleaned.length !== 5) {
      setErroreCap('Il CAP ha cinque cifre. Per Piacenza città è 29121.');
      return;
    }
    setErroreCap(null);
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
        ref={pillolaRef}
        type="button"
        onClick={() => { setOpen((v) => !v); dismissHint(); }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-2.5 py-1.5 rounded-full text-xs font-medium ring-1 ring-white/15 transition-colors focus-visible:outline-white"
        title="Cambia indirizzo di consegna"
      >
        <MapPin size={14} strokeWidth={2.2} className="text-accent-300" />
        {compact ? (
          <span>{loc.zip}</span>
        ) : (
          <>
            {/*
              31/8/2026 (R102) — Questi due erano `opacity-70`: bianco al 70%
              sul terracotta della testata fa 3,49:1, sotto i 4,5:1 che servono
              a chi non ha la vista perfetta, e la pillola sta in cima a OGNI
              pagina del sito. Il bianco pieno sullo stesso fondo fa 5,4:1. La
              gerarchia fra «Consegna a» e la citta' la tiene il grassetto,
              che non costa contrasto.
            */}
            <span className="hidden sm:inline">Consegna a</span>
            <span className="font-semibold">{loc.city}</span>
            <span>{loc.zip}</span>
          </>
        )}
        <ChevronDown size={12} strokeWidth={2.4} className="opacity-70" />
      </button>

      {hint && !open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-64 rounded-xl bg-white p-3 text-ink-900 shadow-warm-lg ring-1 ring-cream-300">
          {/* 27/8/2026 (R110) — la «×» era `text-ink-300` su bianco: 2,52:1,
              sotto il 3:1 che WCAG chiede alle parti grafiche di un comando, e
              il bersaglio erano 14 pixel senza margine. */}
          <button type="button" onClick={dismissHint} aria-label="Chiudi" className="absolute right-1 top-1 rounded-full p-1.5 text-ink-500 hover:text-ink-700">
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
            onClick={() => chiudi(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-labelledby={idTitolo}
            className="absolute left-0 top-full mt-2 w-72 bg-white rounded-xl shadow-warm-lg ring-1 ring-ink-100 p-4 z-50 text-ink-900"
          >
            <p id={idTitolo} className="text-sm font-semibold mb-1">Dove vuoi ricevere?</p>
            <p className="text-xs text-ink-500 mb-3">
              Mostriamo i negozi che consegnano al tuo CAP.
            </p>
            <input
              ref={capRef}
              type="text"
              value={zip}
              onChange={(e) => { setZip(e.target.value); setErroreCap(null); }}
              maxLength={5}
              inputMode="numeric"
              pattern="[0-9]{5}"
              placeholder="29121"
              aria-label="Codice di avviamento postale (CAP)"
              aria-invalid={erroreCap ? true : undefined}
              aria-describedby={erroreCap ? 'cap-errore' : undefined}
              className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
            />
            {erroreCap && (
              <p id="cap-errore" role="alert" className="mt-1 text-xs text-rose-600">
                {erroreCap}
              </p>
            )}
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
