'use client';

import { createElement, useEffect, useRef, useState } from 'react';

/**
 * LA SCHEDA GOOGLE, SOLO COL RIQUADRO UFFICIALE DI GOOGLE — 26/11/2026.
 *
 * Parere legale (termini EEA di Google Maps dall'8/7/2025): voto, recensioni, orari, nome e indirizzo di Google non
 * si salvano e non si copiano. Si tiene solo il `place_id`, e la scheda si mostra col riquadro ufficiale
 * `<gmp-place-details>` (Places UI Kit), caricato in diretta nel browser: lo disegna Google, con la sua
 * attribuzione intatta. Nessuna mappa accanto al riquadro.
 *
 * Spento finché Nicola non scrive la chiave del browser, `NEXT_PUBLIC_GOOGLE_MAPS_CHIAVE` (limitata al dominio
 * del sito, con solo Places UI Kit acceso). Senza chiave, o senza `place_id`, non disegna niente: il titolare
 * legge «non ancora collegata». La politica di sicurezza (middleware.ts) apre i domini di Google solo se la
 * chiave c'è.
 */

const CHIAVE = process.env.NEXT_PUBLIC_GOOGLE_MAPS_CHIAVE?.trim() ?? '';
const ID_SCRIPT = 'google-maps-places-ui-kit';

type GoogleMaps = { maps?: { importLibrary?: (nome: string) => Promise<unknown> } };

/** Carica una volta sola lo script di Google e la libreria Places; risolve a `false` se non riesce. */
let caricamento: Promise<boolean> | null = null;
export function caricaPlaces(chiave: string): Promise<boolean> {
  if (caricamento) return caricamento;
  caricamento = new Promise<boolean>((risolvi) => {
    const pronta = () => {
      const g = (window as unknown as { google?: GoogleMaps }).google;
      if (!g?.maps?.importLibrary) return risolvi(false);
      g.maps.importLibrary('places').then(() => risolvi(true), () => risolvi(false));
    };
    if (document.getElementById(ID_SCRIPT)) return pronta();
    const s = document.createElement('script');
    s.id = ID_SCRIPT;
    s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key: chiave, v: 'weekly', loading: 'async', language: 'it', region: 'IT' })}`;
    s.onload = pronta;
    // Se lo script non arriva, si toglie: così «Riprova» lo chiede di nuovo, invece di ritrovarlo rotto (ricontrollo di mycity#336).
    s.onerror = () => {
      s.remove();
      risolvi(false);
    };
    document.head.appendChild(s);
  }).then((ok) => {
    if (!ok) caricamento = null;
    return ok;
  });
  return caricamento;
}

export const schedaGoogleCollegata = () => CHIAVE.length > 0;

export default function SchedaGoogleUfficiale({ placeId }: { placeId: string | null }) {
  const [stato, setStato] = useState<'attesa' | 'pronta' | 'errore'>('attesa');
  const [tentativo, setTentativo] = useState(0);
  const riquadro = useRef<HTMLDivElement | null>(null);

  // 26/11/2026 — Se Google non riesce a disegnare la scheda (place_id scaduto, chiave rifiutata), il riquadro
  // manda `gmp-error`: allora lo si dice, invece di lasciare un riquadro vuoto (revisione di mycity#336).
  useEffect(() => {
    const el = riquadro.current;
    if (stato !== 'pronta' || !el) return;
    const quandoSbaglia = () => setStato('errore');
    el.addEventListener('gmp-error', quandoSbaglia, true);
    return () => el.removeEventListener('gmp-error', quandoSbaglia, true);
  }, [stato]);

  useEffect(() => {
    if (!CHIAVE || !placeId) return;
    let vivo = true;
    caricaPlaces(CHIAVE).then((ok) => vivo && setStato(ok ? 'pronta' : 'errore'));
    return () => {
      vivo = false;
    };
  }, [placeId, tentativo]);

  if (!placeId) return <p className="text-xs text-ink-400" data-testid="scheda-google">La tua scheda Google: non ancora collegata.</p>;
  if (!CHIAVE) return <p className="text-xs text-ink-400" data-testid="scheda-google">La tua scheda Google: la mostriamo qui appena è collegata.</p>;
  if (stato === 'errore') {
    return (
      <p className="text-xs text-ink-500" data-testid="scheda-google">
        La tua scheda Google non si è caricata.{' '}
        <button type="button" className="font-semibold text-primary-700 underline" onClick={() => { setStato('attesa'); setTentativo((t) => t + 1); }}>
          Riprova
        </button>
      </p>
    );
  }
  if (stato === 'attesa') return <p className="text-xs text-ink-400" data-testid="scheda-google">Carico la tua scheda Google…</p>;
  // Gli elementi di Google si creano senza JSX: React 18 non conosce i loro tipi.
  return (
    <div ref={riquadro} data-testid="scheda-google" className="overflow-hidden rounded-lg border border-cream-200 bg-white">
      {createElement(
        'gmp-place-details',
        null,
        createElement('gmp-place-details-place-request', { place: placeId }),
        createElement('gmp-place-all-content'),
      )}
    </div>
  );
}
