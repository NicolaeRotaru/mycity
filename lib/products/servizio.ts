/**
 * UN ANNUNCIO PUÒ ESSERE UN PRODOTTO OPPURE UN SERVIZIO.
 *
 * 27/11/2026 — Nicola: «permetti di offrire anche servizi oltre a prodotti ai venditori».
 * Il concetto di MyCity è promuovere i «servizi e prodotti» delle attività locali: il
 * parrucchiere, l'estetista, la sarta, chi ripara, il fotografo.
 *
 * COME SI COMPORTA UN SERVIZIO (scelte dell'AD, da confermare con Nicola):
 * - non si compra col carrello e non si paga online, per ora. Al posto di «Aggiungi al
 *   carrello» c'è «Prenota: scrivi al negozio», che apre la chat del sito. Il pagamento
 *   online dei servizi apre la scelta della commissione, che è di Nicola;
 * - non ha scorta (`stock = null`, che nel codice vuol dire già «illimitato»), né varianti,
 *   consegna veloce, condizione, codice a barre o recesso;
 * - ha due dettagli facoltativi: la durata in minuti e dove si fa.
 *
 * Le colonne `tipo`, `durata_minuti` e `dove_servizio` nascono con la migrazione 999g.
 * PRIMA che entri, la colonna `tipo` non c'è: la riga arriva senza e vale «prodotto».
 * Per questo `eServizio` guarda solo un `tipo` uguale a 'servizio', e ogni lettura che
 * chiede le colonne nuove ha un ripiego (`conColonneDelServizio`).
 *
 * Le porte che fermano un servizio: la cassa sul server (lib/ordini/valida-carrello.ts),
 * il carrello del browser (lib/cart.ts), e nel database il trigger
 * `order_items_niente_servizi` della 999g, l'ultima.
 */
import { eSchemaIndietro } from '@/lib/db/migrazione-124';
import { colonnaNonTrovata } from '@/lib/db/migrazione-148';

export const TIPI_DI_ANNUNCIO = ['prodotto', 'servizio'] as const;
export type TipoDiAnnuncio = (typeof TIPI_DI_ANNUNCIO)[number];

export const DOVE_SI_FA = ['in_negozio', 'a_domicilio', 'online'] as const;
export type DoveSiFa = (typeof DOVE_SI_FA)[number];

/** Le etichette di «dove si fa», come le legge il cliente. */
export const ETICHETTE_DOVE: Record<DoveSiFa, string> = {
  in_negozio: 'In negozio',
  a_domicilio: 'A domicilio',
  online: 'Online',
};

/** I limiti della durata, gli stessi del vincolo nel database (999g). */
export const DURATA_MINIMA = 5;
export const DURATA_MASSIMA = 1440;

/** Le colonne che la migrazione 999g aggiunge a `products`. */
export const COLONNE_DEL_SERVIZIO = ['tipo', 'durata_minuti', 'dove_servizio'] as const;

/** Vero solo se l'annuncio è un servizio. Senza `tipo` (prima della 999g) è un prodotto. */
export function eServizio(p: { tipo?: unknown } | null | undefined): boolean {
  return p?.tipo === 'servizio';
}

/** «45 min», «1 h», «1 h 30 min». `null` se la durata non c'è o non è valida. */
export function etichettaDurata(minuti: unknown): string | null {
  const n = typeof minuti === 'number' ? minuti : Number(minuti);
  if (minuti === null || minuti === undefined || minuti === '' || !Number.isInteger(n) || n <= 0) return null;
  if (n < 60) return `${n} min`;
  const ore = Math.floor(n / 60);
  const resto = n % 60;
  return resto === 0 ? `${ore} h` : `${ore} h ${resto} min`;
}

/** «A domicilio». `null` se il valore non è uno dei tre. */
export function etichettaDove(dove: unknown): string | null {
  return typeof dove === 'string' && (DOVE_SI_FA as readonly string[]).includes(dove)
    ? ETICHETTE_DOVE[dove as DoveSiFa]
    : null;
}

/** I dettagli del servizio in una riga: «45 min · A domicilio». `null` se non ce n'è nessuno. */
export function dettagliDelServizio(p: { durata_minuti?: unknown; dove_servizio?: unknown }): string | null {
  const pezzi = [etichettaDurata(p.durata_minuti), etichettaDove(p.dove_servizio)].filter(Boolean);
  return pezzi.length > 0 ? pezzi.join(' · ') : null;
}

/** Il testo del pulsante che prende il posto di «Aggiungi al carrello». */
export const ETICHETTA_PRENOTA = 'Prenota: scrivi al negozio';
export const ETICHETTA_PRENOTA_CORTA = 'Prenota';

/** Il messaggio di chi prova a mettere un servizio nel carrello o in cassa (col nome davanti). */
export const MESSAGGIO_SERVIZIO_NON_IN_CARRELLO =
  'è un servizio: non si compra col carrello. Per prenotarlo scrivi al negozio dalla sua pagina.';

/**
 * Legge con le colonne del servizio e, se il database non le ha ancora (prima della 999g),
 * rilegge senza. Le righe del ripiego non hanno `tipo`: valgono tutte «prodotto», ed è vero,
 * perché senza la colonna nessun annuncio può essere un servizio.
 */
export async function conColonneDelServizio<T extends { error: unknown }>(
  conServizio: () => PromiseLike<T>,
  // Il ripiego ha le stesse righe con una colonna in meno: PostgREST non sa dedurne il tipo
  // da una stringa diversa, quindi si dichiara la forma vera (come `stessaFormaDi`).
  senzaServizio: () => PromiseLike<unknown>,
): Promise<T> {
  const primo = await conServizio();
  if (!primo.error) return primo;
  const e = primo.error as { code?: string; message?: string } | null;
  const nominaUnaColonna = COLONNE_DEL_SERVIZIO.some((c) => new RegExp(`\\b${c}\\b`).test(e?.message ?? ''));
  if (!(eSchemaIndietro(e) && nominaUnaColonna)) return primo;
  return (await senzaServizio()) as T;
}

/** Una scrittura è stata rifiutata perché le colonne del servizio non ci sono ancora? */
export function mancanoLeColonneDelServizio(errore: unknown): boolean {
  const e = errore as { code?: string; message?: string; details?: string } | null;
  if (!e) return false;
  // Dal browser arriva già tradotto dalla porta di scrittura (lib/products/salvataggio-tracciato.ts).
  if (e.message === MESSAGGIO_SERVIZI_NON_ANCORA_ATTIVI) return true;
  return colonnaNonTrovata(e, COLONNE_DEL_SERVIZIO)
    && COLONNE_DEL_SERVIZIO.some((c) => new RegExp(`\\b${c}\\b`).test(`${e.message ?? ''} ${e.details ?? ''}`));
}

/** Cosa legge il negoziante se prova a salvare un servizio prima che il database sia pronto. */
export const MESSAGGIO_SERVIZI_NON_ANCORA_ATTIVI =
  'I servizi non sono ancora attivi sul sito: puoi salvarlo come prodotto, oppure riprovare tra poco.';

/** I dettagli di un servizio che servono alle card. */
export type DettagliServizio = { durata_minuti: number | null; dove_servizio: string | null };

/** Quanti id per richiesta: oltre, l'indirizzo della richiesta diventa troppo lungo. */
const ID_PER_RICHIESTA = 100;

type ClientCheLeggeIServizi = {
  from: (tabella: 'products') => {
    select: (colonne: string) => {
      in: (colonna: string, valori: string[]) => {
        eq: (colonna: string, valore: string) => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
};

/**
 * Quali fra questi annunci sono servizi, coi loro dettagli. Una lettura a parte, a blocchi di
 * cento id: le griglie leggono i prodotti con colonne scritte a mano, e aggiungerci `tipo`
 * farebbe cadere tutto prima della 999g. Se la colonna non c'è ancora la risposta è vuota:
 * ogni annuncio resta un prodotto, ed è vero, perché senza la colonna un servizio non esiste.
 */
export async function leggiServizi(supa: unknown, ids: string[]): Promise<Map<string, DettagliServizio>> {
  const mappa = new Map<string, DettagliServizio>();
  const unici = [...new Set(ids)];
  const client = supa as ClientCheLeggeIServizi;
  for (let i = 0; i < unici.length; i += ID_PER_RICHIESTA) {
    const blocco = unici.slice(i, i + ID_PER_RICHIESTA);
    const { data, error } = await client.from('products').select('id, durata_minuti, dove_servizio').in('id', blocco).eq('tipo', 'servizio');
    if (error) {
      if (eSchemaIndietro(error)) return mappa; // prima della 999g: nessun servizio
      continue;
    }
    if (!Array.isArray(data)) continue;
    for (const r of data as Array<{ id: string } & Partial<DettagliServizio>>) {
      mappa.set(r.id, { durata_minuti: r.durata_minuti ?? null, dove_servizio: r.dove_servizio ?? null });
    }
  }
  return mappa;
}
