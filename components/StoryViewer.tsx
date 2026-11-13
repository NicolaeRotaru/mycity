'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { X, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { caricatoreLogoNegozio } from '@/components/StoreAvatar';
import caricatoreFotoRemote from '@/lib/image-loader';
import { safeInternalPath } from '@/lib/safe-redirect';

/**
 * Viewer fullscreen riusabile per le storie (Instagram-like).
 * Estratto da StoriesCarousel così può essere usato anche dall'anello storia
 * sulla pagina del negozio (StoreStoryRing). Auto-advance 5s + progress bar.
 */
export type StoryItem = {
  id: string;
  image_url: string;
  caption: string | null;
  link_url: string | null;
  seller?: {
    id: string;
    store_name: string | null;
    store_logo: string | null;
  } | null;
};

type Props = {
  stories: StoryItem[];
  startIndex?: number;
  onClose: () => void;
};

export default function StoryViewer({ stories, startIndex = 0, onClose }: Props) {
  const [index, setIndex] = useState(startIndex);
  /**
   * #136 — Le storie si avanzavano da sole ogni cinque secondi e non c'era modo
   * di fermarle. Chi legge piano, chi usa uno screen reader, chi sta guardando
   * il prezzo scritto sulla foto: cinque secondi e via, senza appello. Le
   * regole di accessibilita' dicono una cosa semplice — quello che si muove da
   * solo per piu' di cinque secondi deve potersi fermare.
   *
   * Si mette in pausa in tre modi: col pulsante, quando il fuoco entra nel
   * visore (chi naviga da tastiera sta leggendo), e per chi ha chiesto al
   * sistema di ridurre le animazioni.
   */
  // 5/11/2026 — La scelta fatta col pulsante vince su tutto: null = nessuna scelta, si segue il
  // fuoco da tastiera e la preferenza di meno animazioni.
  const [sceltaAMano, setSceltaAMano] = useState<boolean | null>(null);
  const [fuocoDentro, setFuocoDentro] = useState(false);
  const [menoAnimazioni, setMenoAnimazioni] = useState(false);
  const contenitoreRef = useRef<HTMLDivElement>(null);
  const chiudiRef = useRef<HTMLButtonElement>(null);
  const elementoPrecedente = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    setMenoAnimazioni(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  // #136 — Il visore e' un dialogo: il fuoco entra all'apertura e torna da dove
  // era partito alla chiusura, e Esc chiude.
  useEffect(() => {
    elementoPrecedente.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => chiudiRef.current?.focus(), 20);
    return () => {
      clearTimeout(t);
      elementoPrecedente.current?.focus?.();
    };
  }, []);

  const fermo = sceltaAMano ?? (fuocoDentro || menoAnimazioni);
  // Da dove viene il fuoco: un tasto premuto (Tab, frecce) o un tocco/clic. Il fuoco che il codice
  // mette su «Chiudi» all'apertura non è un gesto da tastiera.
  const ultimoGestoDaTastiera = useRef(false);
  useEffect(() => {
    const tasto = () => { ultimoGestoDaTastiera.current = true; };
    const tocco = () => { ultimoGestoDaTastiera.current = false; };
    document.addEventListener('keydown', tasto, true);
    document.addEventListener('pointerdown', tocco, true);
    return () => {
      document.removeEventListener('keydown', tasto, true);
      document.removeEventListener('pointerdown', tocco, true);
    };
  }, []);
  // Una visualizzazione per storia: prima si contava a ogni cambio di `fermo`.
  const giaContate = useRef<Set<string>>(new Set());
  useEffect(() => {
    const story = stories[index];
    if (!story || giaContate.current.has(story.id)) return;
    giaContate.current.add(story.id);
    supabase.rpc('track_story_view', { p_story: story.id }).then(() => {});
  }, [index, stories]);
  const progressRef = useRef<HTMLDivElement | null>(null);
  // onClose può cambiare identità ad ogni render del parent: lo teniamo in un ref
  // così l'effetto non si ri-arma di continuo.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const story = stories[index];
    if (!story) {
      onCloseRef.current();
      return;
    }
    // #136 — Ferma vuol dire ferma: niente avanzamento automatico e niente
    // barra che scorre.
    if (fermo) return;

    const tid = setTimeout(() => {
      if (index + 1 < stories.length) setIndex(index + 1);
      else onCloseRef.current();
    }, 5000);

    if (progressRef.current) {
      progressRef.current.style.transition = 'none';
      progressRef.current.style.width = '0%';
      // (in pausa non si arriva qui: l'effetto e' gia' uscito sopra)
      requestAnimationFrame(() => {
        if (progressRef.current) {
          progressRef.current.style.transition = 'width 5s linear';
          progressRef.current.style.width = '100%';
        }
      });
    }

    return () => clearTimeout(tid);
  }, [index, stories, fermo]);

  // Tasti freccia + Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setIndex((i) => (i + 1 < stories.length ? i + 1 : i));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stories.length]);

  const active = stories[index];
  if (!active) return null;
  /**
   * 13/11/2026 (R16-011) — Il «Scopri di più» porta solo dentro MyCity. Il link lo scrive il
   * negozio a mano, e prima si apriva così com'era: anche un sito esterno, senza dire al cliente
   * che stava uscendo da MyCity. Vale solo un percorso del sito, con la stessa regola dei ritorni
   * dopo l'accesso (lib/safe-redirect.ts): un link che non la passa non si mostra.
   */
  const linkInterno = safeInternalPath(active.link_url, '');

  return (
    <div
      ref={contenitoreRef}
      role="dialog"
      aria-modal="true"
      aria-label="Storie dei negozi"
      // 5/11/2026 — In pausa per il fuoco solo se arriva da tastiera: il fuoco che il codice mette
      // su «Chiudi» all'apertura fermava il visore appena aperto, e «Riprendi» non lo sbloccava.
      onFocus={() => {
        if (ultimoGestoDaTastiera.current) setFuocoDentro(true);
      }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFuocoDentro(false); }}
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
    >
      {/* 27/8/2026 (R118) — le barrette qui sotto dicono a colpo d'occhio a che
          punto sei, ma sono `<div>` vuoti: in tutto il visore non esisteva da
          nessuna parte un «Storia 2 di 5». Chi ascolta non sapeva né quante ne
          restassero né dove si trovava. */}
      <p className="sr-only" role="status" aria-live="polite">
        Storia {index + 1} di {stories.length}
      </p>

      {/* Progress bar in alto */}
      <div className="absolute top-0 left-0 right-0 flex gap-1 p-2 z-10" aria-hidden>
        {stories.map((_, i) => (
          <div key={i} className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
            {i === index ? (
              <div ref={progressRef} className="h-full bg-white" style={{ width: '0%' }} />
            ) : i < index ? (
              <div className="h-full bg-white w-full" />
            ) : null}
          </div>
        ))}
      </div>

      <button
        ref={chiudiRef}
        onClick={() => onCloseRef.current()}
        className="absolute top-4 right-4 text-white bg-black/40 rounded-full p-2 z-20"
        aria-label="Chiudi storia"
      >
        <X size={20} />
      </button>

      {/* #136 — Il comando che mancava. */}
      <button
        type="button"
        onClick={() => setSceltaAMano(!fermo)}
        className="absolute top-4 right-16 text-white bg-black/40 rounded-full p-2 z-20"
        aria-label={fermo ? 'Riprendi le storie' : 'Metti in pausa le storie'}
        aria-pressed={fermo}
      >
        {fermo ? <Play size={20} /> : <Pause size={20} />}
      </button>

      {index > 0 && (
        <button
          onClick={() => setIndex(index - 1)}
          className="absolute left-2 sm:left-6 text-white bg-black/40 hover:bg-black/60 rounded-full p-3 z-10"
          aria-label="Storia precedente"
        >
          <ChevronLeft size={24} />
        </button>
      )}

      {index < stories.length - 1 && (
        <button
          onClick={() => setIndex(index + 1)}
          className="absolute right-2 sm:right-6 text-white bg-black/40 hover:bg-black/60 rounded-full p-3 z-10"
          aria-label="Prossima storia"
        >
          <ChevronRight size={24} />
        </button>
      )}

      <div className="relative max-w-md w-full h-[80vh] max-h-[700px] mx-4">
        <div className="relative w-full h-full rounded-2xl overflow-hidden">
          <Image
            src={sizedImage(active.image_url, 'hero')}
            // #136 — L'immagine E' il contenuto: con alt vuoto veniva
            // dichiarata decorativa, cioe' per chi non vede la storia non
            // esisteva proprio.
            alt={active.caption ?? `Storia di ${active.seller?.store_name ?? 'un negozio'}`}
            fill
            sizes="(max-width: 768px) 90vw, 500px"
            loader={caricatoreFotoRemote}
            className="object-cover"
            priority
          />
          {active.seller && (
            <div className="absolute top-6 left-4 flex items-center gap-2">
              {active.seller.store_logo && (
                <Image
                  src={active.seller.store_logo}
                  alt=""
                  width={36}
                  height={36}
                  // 5/11/2026 — la misura la fa Supabase (solo larghezza), non anche Vercel.
                  loader={caricatoreLogoNegozio}
                  className="rounded-full ring-2 ring-white bg-white object-contain w-9 h-9"
                />
              )}
              <Link
                href={`/store/${active.seller.id ?? ''}`}
                className="text-white font-bold drop-shadow hover:underline"
              >
                {active.seller.store_name ?? '—'}
              </Link>
            </div>
          )}
          {active.caption && (
            <div className="absolute bottom-4 left-4 right-4">
              <p className="text-white font-semibold drop-shadow-lg bg-black/30 rounded-lg p-3 backdrop-blur-sm">
                {active.caption}
              </p>
            </div>
          )}
          {linkInterno && (
            <Link
              href={linkInterno}
              className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-white text-ink-900 font-bold px-5 py-2 rounded-full shadow-warm-lg whitespace-nowrap"
            >
              Scopri di più →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
