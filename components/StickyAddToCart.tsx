'use client';

import { useEffect, useRef, useState } from 'react';
import { ShoppingCart, Minus, Plus } from 'lucide-react';
import { formatPrice } from '@/lib/format';
import { fondoDellaBarra, corsieSotto } from '@/lib/ui/barra-in-fondo';
import { seguiAltezza, osservatoreDelBrowser } from '@/lib/altezza-banner';

/** La corsia che questa barra occupa, in fondo allo schermo. */
const MIA_CORSIA = '--altezza-barra-acquisto';

type Props = {
  price: number;
  available: boolean;
  onAdd: () => void;
  /** Microcopy di rassicurazione sotto il prezzo (es. "Paghi alla consegna"). */
  note?: string;
  /** Quantità corrente: se fornita, la barra mostra stepper + "{qty}×{price}" + totale. */
  qty?: number;
  /** Decrementa/incrementa la quantità (richiesti per abilitare lo stepper). */
  onDec?: () => void;
  onInc?: () => void;
  /** Limiti dello stepper (disabilita i pulsanti agli estremi). */
  canDec?: boolean;
  canInc?: boolean;
};

/**
 * Bottone CTA sticky in fondo allo schermo su mobile — best practice retail
 * (Amazon, Asos, Glovo). Compare quando l'utente scrolla giù oltre l'header.
 *
 * Solo lg:hidden — la colonna appiccicata a destra della scheda prodotto esiste solo da `lg`.
 * Era `md:hidden`, e fra 768 e 1023 pixel spariva questa barra mentre lassù il riquadro d'acquisto
 * era già scivolato in seconda riga: in quella fascia non restava nessun pulsante per comprare
 * senza scorrere sotto tutta la colonna delle informazioni.
 * Lascia spazio per la MobileTabBar in basso (z-index + bottom offset).
 *
 * Con `qty` + `onDec`/`onInc` mostra lo stepper, la riga "{qty} × {price}" e il
 * totale (qty×price); altrimenti resta la versione compatta solo prezzo + CTA.
 */
/**
 * L'ETICHETTA DEL PULSANTE, e perché ce ne sono due.
 *
 * 3/9/2026 — A 360 pixel il conto non tornava. Dentro la card ci sono 312 pixel: lo stepper ne
 * prende 98 e il pulsante con la scritta intera e l'icona ne chiedeva più di 200, prima ancora del
 * prezzo. Risultato: «Aggiungi al carrello» andava a capo su due righe e il blocco del prezzo si
 * stringeva sotto la larghezza della cifra, che usciva dal suo riquadro. Il conto restava negativo
 * anche a 375 e 390 pixel, cioè sui telefoni più venduti.
 *
 * Sotto i 640 pixel si scrive la parola corta e l'icona resta fuori. Il nome per intero non si
 * perde: sta nell'`aria-label`, quindi chi naviga a voce sente la frase completa. Le due misure
 * stanno qui, in un posto solo, perché la prova che tiene il conto le legge da qui.
 */
const ETICHETTA_CORTA = 'Aggiungi';
const ETICHETTA_INTERA = 'Aggiungi al carrello';
const ETICHETTA_ESAURITO_CORTA = 'Esaurito';
const ETICHETTA_ESAURITO = 'Non disponibile';

export default function StickyAddToCart({ price, available, onAdd, note, qty, onDec, onInc, canDec, canInc }: Props) {
  const [visible, setVisible] = useState(false);
  const barraRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => {
      // Visible quando si scrolla oltre la prima metà del primo schermo
      const trigger = Math.max(300, window.innerHeight * 0.5);
      setVisible(window.scrollY > trigger);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 3/9/2026 — QUESTA BARRA DICE QUANTO E' ALTA, e chi le sta sopra la legge.
  //
  // Il pulsante tondo dell'assistenza stava a 96 pixel scritti a mano e finiva
  // sopra il lato destro di «Aggiungi al carrello»: il tocco apriva
  // l'assistenza invece di comprare. Nessuno poteva spostarlo, perche' nessuno
  // sapeva quanto e' alta questa barra. Ora lo dichiara — e lo ridichiara
  // mentre cambia, come fa il banner dei cookie: il totale va a capo su uno
  // schermo stretto, la barra cresce, e chi le sta sopra si sposta con lei.
  useEffect(() => {
    if (!visible) return;
    return seguiAltezza(barraRef.current, document.documentElement, osservatoreDelBrowser, MIA_CORSIA);
  }, [visible]);

  if (!visible) return null;

  const hasStepper = typeof qty === 'number' && !!onDec && !!onInc;
  const total = typeof qty === 'number' ? price * qty : price;

  return (
    <div
      ref={barraRef}
      // 27/8/2026 (R096) — Via `pb-safe`: la safe-area la conta gia' `bottom`
      // qui sotto. Contata due volte, la barra galleggiava staccata dal fondo
      // con una fascia vuota sotto il pulsante d'acquisto.
      className="lg:hidden fixed left-0 right-0 z-30 transition-transform duration-300 animate-slide-up"
      // #124 — Sopra la barra a schede e, quando c'e', sopra il banner dei
      // cookie: prima ci finiva sotto e il pulsante d'acquisto spariva.
      // Le corsie sotto di lei non sono piu' ricopiate qui: le tiene
      // lib/ui/barra-in-fondo.ts, insieme all'ordine di chi sta sopra chi.
      style={{ bottom: fondoDellaBarra(corsieSotto(MIA_CORSIA)) }}
      // 30/8/2026 (R108) — Senza `role` questa etichetta non arrivava a
      // nessuno: un `aria-label` su un contenitore generico le tecnologie
      // assistive lo buttano via. Era un nome che chi l'ha scritto credeva di
      // aver dato.
      role="region"
      aria-label="Acquisto rapido"
    >
      <div className="container mx-auto px-3">
        <div className="bg-white border border-cream-300 rounded-2xl shadow-warm-lg p-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              {hasStepper && (
                <p className="truncate text-[11px] text-ink-400 leading-tight">{qty} × {formatPrice(price)}</p>
              )}
              <p className="truncate text-lg font-bold text-primary-700 leading-tight">{formatPrice(total)}</p>
            </div>

            {hasStepper && (
              <div
                className="flex items-center rounded-full border border-cream-300 overflow-hidden shrink-0"
                // Stesso motivo: `aria-label` senza ruolo non veniva esposta.
                role="group"
                aria-label="Quantità"
              >
                <button
                  type="button"
                  onClick={onDec}
                  disabled={canDec === false}
                  aria-label="Diminuisci quantità"
                  className="w-9 h-9 inline-flex items-center justify-center text-ink-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Minus size={16} aria-hidden />
                </button>
                {/* 30/8/2026 (R108) — Era uno <span>. Si premeva «+», il numero
                    cambiava a video e chi non vede lo schermo non sentiva niente:
                    tre pressioni e nessun modo di sapere se stavi comprando una
                    confezione o quattro. Nella scheda prodotto e nel carrello lo
                    stesso numero sta in un <output> da mesi: qui era rimasto
                    indietro proprio sulla strada da cui si compra col telefono. */}
                <output
                  aria-live="polite"
                  aria-atomic="true"
                  className="min-w-[1.5rem] text-center text-sm font-bold text-ink-900"
                >
                  {qty}
                </output>
                <button
                  type="button"
                  onClick={onInc}
                  disabled={canInc === false}
                  aria-label="Aumenta quantità"
                  className="w-9 h-9 inline-flex items-center justify-center text-ink-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={16} aria-hidden />
                </button>
              </div>
            )}

            <button
              onClick={onAdd}
              disabled={!available}
              // Il nome intero resta qui anche quando a schermo si legge la parola corta.
              aria-label={available ? ETICHETTA_INTERA : ETICHETTA_ESAURITO}
              className="ml-auto inline-flex shrink-0 items-center gap-2 whitespace-nowrap bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-ink-900 px-4 sm:px-5 py-3 rounded-full font-bold text-sm transition-colors"
            >
              <ShoppingCart size={18} strokeWidth={2.4} className="hidden sm:inline" aria-hidden />
              <span className="sm:hidden">{available ? ETICHETTA_CORTA : ETICHETTA_ESAURITO_CORTA}</span>
              <span className="hidden sm:inline">{available ? ETICHETTA_INTERA : ETICHETTA_ESAURITO}</span>
            </button>
          </div>

          {/* 3/9/2026, secondo giro — «PAGHI ALLA CONSEGNA» SI LEGGEVA «PAGHI ALLA CONSE…».
              Questa riga stava dentro il blocco del prezzo, cioè nello stesso spazio che si
              dividono lo stepper e il pulsante: a 360 pixel — l'iPhone SE e mezza Piacenza con
              Android — a quel blocco restavano 93 pixel e la frase ne chiede 121. Col `truncate`,
              messo per proteggere la CIFRA, veniva tagliata: l'unica rassicurazione visibile nel
              momento in cui si decide di comprare, mozzata a metà. Chi non vuole anticipare i
              soldi non si tranquillizza: si insospettisce.
              Adesso la riga sta SOTTO, sulla larghezza intera della card: 312 pixel invece di 93.
              Non compete più con i due comandi, e non ha bisogno di essere tagliata per stare al
              suo posto. La prova rifà il conto con il testo vero che la scheda prodotto passa. */}
          <p className="mt-1 text-[11px] text-olive-700 font-medium leading-tight">
            {note ?? 'Totale'}
          </p>
        </div>
      </div>
    </div>
  );
}
