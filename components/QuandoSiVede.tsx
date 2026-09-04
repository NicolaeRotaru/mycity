'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * MONTA IL CONTENUTO SOLO QUANDO CI SI ARRIVA.
 *
 * ── Il difetto che ha prodotto questo componente ────────────────────────────────────────────
 * Aprendo una scheda prodotto partivano dieci interrogazioni al database tutte insieme. Quattro
 * riguardavano roba che sta in fondo alla pagina — «prodotti simili», «visti di recente»,
 * «domande e risposte», «spesso comprati insieme» — e nessuna aspettava di essere raggiunta: le
 * loro condizioni erano solo «esiste l'id». Su rete mobile quelle quattro occupavano le
 * connessioni nell'istante esatto in cui dovevano arrivare il prezzo e la foto grande.
 *
 * ── La regola, scritta una volta e riusabile ────────────────────────────────────────────────
 * Sopra la piega si carica subito. Sotto la piega si carica quando ci si arriva. Il figlio non
 * viene montato finché il segnaposto non entra nello schermo (con 200 pixel di anticipo, così il
 * contenuto è già lì quando l'occhio ci arriva): non montato vuol dire che le sue `useQuery` non
 * esistono ancora, quindi non chiedono niente.
 *
 * ⚠️ Il segnaposto tiene l'altezza dichiarata in `altezzaMinima`: senza, la pagina salterebbe
 * sotto le dita mentre si scorre — e uno che sta per premere «Aggiungi al carrello» preme altro.
 *
 * ⚠️ Se il browser non ha `IntersectionObserver` (o siamo nel render del server) il figlio si
 * monta subito: una richiesta in più è meglio di una sezione che non compare mai.
 */
export default function QuandoSiVede({
  children,
  altezzaMinima = 200,
  margine = '200px',
}: {
  children: ReactNode;
  /** Quanto spazio tenere occupato finché il contenuto non arriva, in pixel. */
  altezzaMinima?: number;
  /** Con quanto anticipo montare, prima che il segnaposto entri davvero nello schermo. */
  margine?: string;
}) {
  const segnaposto = useRef<HTMLDivElement>(null);
  const [arrivato, setArrivato] = useState(false);

  useEffect(() => {
    if (arrivato) return;
    if (typeof IntersectionObserver === 'undefined') {
      setArrivato(true);
      return;
    }
    const nodo = segnaposto.current;
    if (!nodo) return;

    const osservatore = new IntersectionObserver(
      (voci) => {
        if (voci.some((v) => v.isIntersecting)) {
          setArrivato(true);
          osservatore.disconnect();
        }
      },
      { rootMargin: margine },
    );
    osservatore.observe(nodo);
    return () => osservatore.disconnect();
  }, [arrivato, margine]);

  if (arrivato) return <>{children}</>;

  return <div ref={segnaposto} style={{ minHeight: altezzaMinima }} aria-hidden />;
}
