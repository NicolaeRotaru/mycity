'use client';

import { useEffect, useState } from 'react';
import { Bike } from 'lucide-react';
import { cn } from '@/lib/cn';
import { romeNow } from '@/lib/store-hours';
import { rigaConsegnaDellaScheda } from '@/lib/promessa-consegna';
import { QUANDO_ARRIVA_SENZA_NEGOZIO } from '@/lib/promesse-pubbliche';

/**
 * La promessa onesta quando non si sa di quale negozio si parla: nessun «oggi», nessun minuto.
 * 29/10/2026 — Una copia sola: la frase vive in lib/promesse-pubbliche (che i componenti client
 * importano già), qui si attacca solo «Consegna». Prima erano due testi uguali scritti a mano.
 */
export const RIGA_CONSEGNA_SENZA_NEGOZIO = `Consegna ${QUANDO_ARRIVA_SENZA_NEGOZIO}`;

const UN_MINUTO = 60_000;

/**
 * L'ora di Piacenza (`romeNow`, come le rotte), `null` prima dell'idratazione: Date.now() differisce
 * fra server e client. Batte al minuto e si ferma a scheda nascosta: serve solo a vedere un negozio
 * che apre o chiude mentre la pagina è aperta. Niente conto alla rovescia (29/10).
 */
export function useOraDiPiacenza(): Date | null {
  const [adesso, setAdesso] = useState<Date | null>(null);
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const ferma = () => { if (id) { clearInterval(id); id = null; } };
    const avvia = () => {
      ferma();
      setAdesso(romeNow());
      id = setInterval(() => setAdesso(romeNow()), UN_MINUTO);
    };
    const suVisibilita = () => {
      if (document.visibilityState === 'visible') avvia();
      else ferma();
    };
    avvia();
    document.addEventListener('visibilitychange', suVisibilita);
    return () => {
      ferma();
      document.removeEventListener('visibilitychange', suVisibilita);
    };
  }, []);
  return adesso;
}

/**
 * La veloce si nomina solo se la cassa dice sì: stessa domanda del carrello e della cassa
 * (/api/consegna/veloce → `veloceSiPuo`). `null` se non si chiede, se la risposta non arriva o cade:
 * allora niente minuti.
 */
export function useVeloceDelNegozio(negozioId: string | undefined, chiedi: boolean): boolean | null {
  const [veloce, setVeloce] = useState<boolean | null>(null);
  useEffect(() => {
    if (!negozioId || !chiedi) return;
    let vivo = true;
    fetch(`/api/consegna/veloce?negozi=${encodeURIComponent(negozioId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((esito: { possibile?: boolean } | null) => {
        if (vivo) setVeloce(esito ? esito.possibile === true : null);
      })
      .catch(() => {
        if (vivo) setVeloce(null);
      });
    return () => {
      vivo = false;
    };
  }, [negozioId, chiedi]);
  return negozioId && chiedi ? veloce : null;
}

/**
 * Quando arriva la spesa, detto come lo dice la cassa (29/10/2026, regola di Nicola):
 *  - prodotto esaurito → nessun tempo di consegna (il componente non disegna niente);
 *  - negozio chiuso adesso → quando riapre, e che l'ora si sceglie in cassa;
 *  - altrimenti → «Consegna a casa, all'ora che scegli», e la veloce solo se la cassa ha detto sì.
 * Non c'è più il «Consegna in 2-3 giorni» (la cassa non ha quella consegna) né il conto fino alle 18
 * (sbagliato per ogni negozio che non chiude alle 18). La decisione è `rigaConsegnaDellaScheda`.
 * Variante `banner` per blocchi in evidenza, `inline` per pagine prodotto.
 */
export function DeliveryCutoff({
  variant = 'inline',
  esaurito = false,
  storeHours,
  negozioId,
  externalDeliveryLabel,
  senzaNegozio = false,
  className,
}: {
  variant?: 'inline' | 'banner';
  /** Prodotto esaurito: nessun tempo di consegna. */
  esaurito?: boolean;
  /**
   * Gli orari del negozio. Senza, un negozio di cui non sappiamo gli orari non è un negozio chiuso —
   * è la stessa scelta che fa il server, che senza orari lascia passare l'ordine.
   */
  storeHours?: unknown;
  /** Il negozio del prodotto: serve per chiedere alla cassa se la veloce si può adesso. */
  negozioId?: string;
  /** Prodotto importato da marketplace: mostra il tempo di consegna esterno. */
  externalDeliveryLabel?: string | null;
  /**
   * Dove non c'è UN negozio di cui conoscere gli orari (la home), non si promette «oggi»: si dice
   * la regola vera (in giornata, negli orari del negozio). Nicola, 26/10: niente minuti.
   */
  senzaNegozio?: boolean;
  className?: string;
}) {
  const adesso = useOraDiPiacenza();
  const veloce = useVeloceDelNegozio(negozioId, !senzaNegozio && !esaurito && !externalDeliveryLabel);

  const riga = senzaNegozio
    ? RIGA_CONSEGNA_SENZA_NEGOZIO
    : rigaConsegnaDellaScheda({ esaurito, orari: storeHours, adesso, veloce, consegnaEsterna: externalDeliveryLabel });
  if (riga === null) return null;

  if (variant === 'banner') {
    return (
      // 6/9/2026 — La scatola riserva da subito lo spazio di due righe: la frase cambia dopo
      // l'idratazione (negozio chiuso, o la veloce confermata dalla cassa) e va a capo nei 384
      // punti dell'hero; senza la riserva la scatola crescerebbe mentre uno legge le righe sotto.
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg bg-olive-50 text-olive-800 px-3 py-2 text-sm font-medium',
          // Due righe di testo piccolo (2 × 1,25rem) più il padding verticale (2 × 0,5rem).
          'min-h-[3.5rem]',
          className,
        )}
      >
        <Bike size={18} strokeWidth={2.2} className="text-olive-600 shrink-0" aria-hidden />
        <span>{riga}</span>
      </div>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-olive-700 font-medium', className)}>
      <Bike size={15} strokeWidth={2.2} className="text-olive-600 shrink-0" aria-hidden />
      <span>{riga}</span>
    </span>
  );
}
