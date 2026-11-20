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
export function useOraDiPiacenza(attivo: boolean = true): Date | null {
  const [adesso, setAdesso] = useState<Date | null>(null);
  useEffect(() => {
    // Dove il riquadro non si vede (la home sul telefono) l'orologio non parte: niente battito al
    // minuto per un'ora che nessuno legge.
    if (!attivo) return;
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
  }, [attivo]);
  return adesso;
}

/**
 * La veloce si nomina solo se la cassa dice sì: stessa domanda del carrello e della cassa
 * (/api/consegna/veloce → `veloceSiPuo`). `null` se non si chiede, se la risposta non arriva o cade:
 * allora niente minuti.
 */
/** Dopo quanto una risposta sulla veloce si richiede, al ritorno sulla scheda. */
const RICHIEDI_VELOCE_MS = 5 * 60_000;

/**
 * 20/11/2026 (R02-018) — UNA DOMANDA PER TUTTA LA LISTA, E A OGNI SCHEDA IL SUO ESITO.
 *
 * Ogni scheda dell'elenco dei negozi chiedeva la veloce del suo negozio per conto suo: duecento
 * schede, duecento domande, contro il freno per indirizzo che usa anche il carrello. Adesso le schede
 * che chiedono nello stesso giro (lo stesso disegno, lo stesso ritorno sulla pagina) si raccolgono qui
 * e partono insieme verso /api/consegna/veloce/negozi, che risponde una mappa negozio → esito: ogni
 * scheda legge il SUO. Non /api/consegna/veloce con più negozi: quella risponde un sì o no per tutti
 * insieme (la domanda del carrello), e ogni scheda avrebbe avuto il verdetto della lista.
 * Una scheda sola nel giro (la scheda prodotto, la vetrina di un negozio) chiede come prima.
 */
const NEGOZI_PER_DOMANDA = 100;
type AttesaVeloce = (esito: boolean | null) => void;
const veloceInAttesa = new Map<string, AttesaVeloce[]>();
let giroVeloceProgrammato = false;

function rispondiVeloce(giro: Map<string, AttesaVeloce[]>, id: string, esito: boolean | null) {
  for (const risolvi of giro.get(id) ?? []) risolvi(esito);
}

function partiVeloce() {
  giroVeloceProgrammato = false;
  const giro = new Map(veloceInAttesa);
  veloceInAttesa.clear();
  const ids = [...giro.keys()];
  if (ids.length === 1) {
    const [id] = ids;
    fetch(`/api/consegna/veloce?negozi=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((esito: { possibile?: boolean } | null) => rispondiVeloce(giro, id, esito ? esito.possibile === true : null))
      .catch(() => rispondiVeloce(giro, id, null));
    return;
  }
  for (let i = 0; i < ids.length; i += NEGOZI_PER_DOMANDA) {
    const blocco = ids.slice(i, i + NEGOZI_PER_DOMANDA);
    fetch(`/api/consegna/veloce/negozi?negozi=${blocco.map(encodeURIComponent).join(',')}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((risposta: { esiti?: Record<string, { possibile?: boolean } | undefined> } | null) => {
        for (const id of blocco) {
          const suo = risposta?.esiti?.[id];
          // Un negozio senza la sua riga nella risposta è «non so», non «no».
          rispondiVeloce(giro, id, suo ? suo.possibile === true : null);
        }
      })
      .catch(() => { for (const id of blocco) rispondiVeloce(giro, id, null); });
  }
}

/** La veloce di un negozio, chiesta insieme a quelle delle altre schede dello stesso giro. */
function chiediVeloce(negozioId: string): Promise<boolean | null> {
  return new Promise((risolvi) => {
    const attese = veloceInAttesa.get(negozioId) ?? [];
    attese.push(risolvi);
    veloceInAttesa.set(negozioId, attese);
    if (!giroVeloceProgrammato) {
      giroVeloceProgrammato = true;
      // Dopo gli effetti di tutto il disegno (girano uno dopo l'altro, nello stesso turno).
      queueMicrotask(partiVeloce);
    }
  });
}

export function useVeloceDelNegozio(negozioId: string | undefined, chiedi: boolean): boolean | null {
  const [veloce, setVeloce] = useState<boolean | null>(null);
  useEffect(() => {
    // S10 (5/11/2026, 2260) — Il sì di stamattina non si rivede mentre arriva
    // la risposta nuova: si riparte da «non so».
    setVeloce(null);
    if (!negozioId || !chiedi) return;
    let vivo = true;
    let ultimaDomanda = 0;
    const domanda = () => {
      ultimaDomanda = Date.now();
      void chiediVeloce(negozioId).then((esito) => {
        if (vivo) setVeloce(esito);
      });
    };
    domanda();
    // S10 (5/11/2026, 2298) — La risposta si chiedeva una volta sola: se il
    // fattorino smetteva il servizio, la scheda rimasta aperta continuava a
    // dire «oggi». Si richiede quando la scheda torna visibile, se la risposta
    // ha piu' di 5 minuti (revisione S10: niente raffiche sulla lista dei
    // negozi, dove le righe chiedono insieme ma la rotta ha un freno).
    const suVisibilita = () => {
      if (document.visibilityState === 'visible' && Date.now() - ultimaDomanda >= RICHIEDI_VELOCE_MS) domanda();
    };
    document.addEventListener('visibilitychange', suVisibilita);
    return () => {
      vivo = false;
      document.removeEventListener('visibilitychange', suVisibilita);
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
    // S10 (5/11/2026, 2299) — Come il banner, anche la riga riserva lo spazio di
    // due righe sul telefono: dopo la risposta della cassa la frase si allunga
    // («…oppure veloce in 30-60 minuti») e spingeva giù il riquadro mentre si
    // leggeva. R08-002 — Lo spazio di due righe si tiene a ogni larghezza, come la banner: fra 768 e
    // 1023 pixel la colonna è stretta quanto un telefono e «da sm in su ci sta in una riga» era falso.
    // 20/11/2026 (R02-009) — Due righe non bastavano: col negozio chiuso, dopo il caricamento, la
    // frase diventa «Il negozio è chiuso ora, riapre domani alle 08:00: in cassa scegli l'ora della
    // consegna» (87 caratteri), tre righe nella colonna di un telefono da 360 punti e in quella della
    // scheda fra 1024 e 1279 (la più stretta: 1fr di tre colonne). Sotto i 1280 se ne tengono tre
    // (3 × 1,25rem); da 1280, dove la colonna è larga, ne bastano due.
    <span className={cn('inline-flex items-start gap-1.5 text-sm text-olive-700 font-medium min-h-[2.5rem] max-xl:min-h-[3.75rem]', className)}>
      <Bike size={15} strokeWidth={2.2} className="text-olive-600 shrink-0" aria-hidden />
      <span>{riga}</span>
    </span>
  );
}
