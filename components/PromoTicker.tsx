'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pause, Play, Tag } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useBranding } from './hooks/useBranding';
import { wedgeIcon } from '@/lib/site-branding';
import { ciSonoPromoAttive } from '@/lib/queries/promo-attive';

/**
 * Striscia in cima: la promessa di MyCity (il "wedge"), gestita dall'admin via
 * /admin/branding (site_settings.branding, con fallback ai testi di default), più
 * UNO slot promo che si accende solo se ci sono promozioni reali attive E il link
 * è abilitato nel branding.
 *
 * Scorre come marquee continuo (utility `animate-marquee` in globals.css): il
 * keyframe trasla del -50%, quindi la "track" del contenuto è duplicata due volte
 * dentro al flex animato per un loop senza salti. La pausa-su-hover è nel CSS.
 * La seconda copia è `aria-hidden` (duplicato puramente visivo). Con
 * prefers-reduced-motion l'animazione è di fatto ferma (globals.css) → la prima
 * track resta visibile e leggibile.
 */
export default function PromoTicker() {
  const branding = useBranding();
  /**
   * 30/8/2026 (R111) — LA STRISCIA SCORREVA DA SOLA E SUL TELEFONO NON SI
   * POTEVA FERMARE.
   *
   * È contenuto in movimento che parte da solo, dura più di cinque secondi e
   * sta accanto ad altro contenuto: le linee guida di accessibilità (WCAG
   * 2.2.2, livello A) chiedono un modo per fermarlo. Gli unici modi previsti
   * erano `:hover`, `:focus-within` e `:active`: il passaggio del mouse su un
   * telefono non esiste, `:active` dura finché tieni il dito premuto (non è un
   * comando), e `focus-within` funziona solo se dentro c'è qualcosa che prende
   * il fuoco — cioè il link «Promozioni attive», che compare soltanto quando ci
   * sono promozioni attive. Nel caso normale, su un telefono, non c'era NESSUN
   * modo di fermarla.
   *
   * Per chi ha dislessia, disturbi dell'attenzione o vertigini da movimento è
   * la prima cosa che si vede entrando nel sito.
   *
   * Il comando è quello che il progetto usa già per le storie
   * (`components/StoryViewer.tsx`). La pausa è scritta come stile in linea e
   * non come classe: così è la stessa cosa che si prova e che si vede.
   */
  const [inPausa, setInPausa] = useState(false);

  const { data: hasPromo = false } = useQuery({
    queryKey: ['promotions', 'active-any'],
    staleTime: 5 * 60_000,
    // 27/8/2026 (R084) — la domanda è da sì/no, e si chiedeva col conteggio esatto di TUTTE le
    // promozioni, su ogni pagina del sito. Ora si chiede una riga sola: `lib/queries/promo-attive.ts`.
    queryFn: () => ciSonoPromoAttive(supabase),
  });

  const showPromo = hasPromo && branding.announcement.promoLinkEnabled;

  // Una singola "track": gli annunci + (eventuale) slot promo. Viene renderizzata
  // due volte fianco a fianco così il translateX(-50%) ripete il loop senza salti.
  /**
   * 22/8/2026 — LA COPIA ERA NASCOSTA AI LETTORI DI SCHERMO MA NON ALLA TASTIERA.
   *
   * La striscia si disegna due volte per far scorrere il testo senza salti. La
   * seconda copia aveva `aria-hidden`, quindi un lettore di schermo non la
   * leggeva — ma il link «Promozioni attive» dentro restava raggiungibile con
   * Tab. Chi naviga da tastiera arrivava su un link annunciato come nulla: il
   * fuoco spariva su un elemento che, per chi ascolta, non esiste.
   *
   * `inert` toglie la copia sia dalla lettura sia dalla tastiera, che è quello
   * che si voleva fin dall'inizio.
   */
  const Track = ({ ariaHidden = false }: { ariaHidden?: boolean }) => (
    <div
      aria-hidden={ariaHidden || undefined}
      inert={ariaHidden || undefined}
      className="flex shrink-0 items-center gap-x-8 px-4 sm:gap-x-10"
    >
      {branding.announcement.items.map((it, i) => {
        const Icon = wedgeIcon(it.icon);
        return (
          <span key={i} className="flex shrink-0 items-center gap-1.5">
            <Icon size={14} strokeWidth={2.2} className="text-accent-400" />
            <span className="font-medium">{it.text}</span>
          </span>
        );
      })}
      {showPromo && (
        <Link
          href="/promozioni"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-500 px-3 py-0.5 font-bold text-ink-900 transition-colors hover:bg-accent-400"
        >
          <Tag size={13} strokeWidth={2.6} />
          Promozioni attive · Scopri
        </Link>
      )}
    </div>
  );

  return (
    <div className="relative flex items-center overflow-hidden border-b border-ink-800 bg-ink-900 text-xs text-ink-100 sm:text-sm">
      <div
        data-striscia
        className="animate-marquee flex w-max items-center whitespace-nowrap py-2"
        style={inPausa ? { animationPlayState: 'paused' } : undefined}
      >
        <Track />
        <Track ariaHidden />
      </div>
      <button
        type="button"
        onClick={() => setInPausa((p) => !p)}
        aria-label={inPausa ? 'Riprendi la striscia degli annunci' : 'Metti in pausa la striscia degli annunci'}
        aria-pressed={inPausa}
        className="absolute right-0 top-0 flex h-full shrink-0 items-center bg-ink-900 px-2 text-ink-300 hover:text-ink-100"
      >
        {inPausa ? <Play size={14} strokeWidth={2.4} aria-hidden /> : <Pause size={14} strokeWidth={2.4} aria-hidden />}
      </button>
    </div>
  );
}
