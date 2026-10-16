/**
 * 15/10/2026 (R33) — NELLE CONSEGNE IN CONTANTI PRIMA SI DICHIARA L'INCASSO,
 * POI SI CHIUDE LA CONSEGNA.
 *
 * Su un ordine pagato alla consegna le conferme sono due: il codice che il
 * cliente detta alla porta e l'incasso che il fattorino dichiara. Senza
 * l'incasso la rimessa della sera salta l'ordine (`confirm_cod_remittance`) e
 * il negozio non viene pagato.
 *
 * Prima la pagina della consegna metteva in fondo allo schermo il grande
 * pulsante verde «Conferma consegna» e il riquadro dell'incasso piu' in alto,
 * sotto la mappa: su un telefono da 360 pixel fuori schermo. Il fattorino
 * dettava il codice, leggeva «Consegna confermata!» e dopo un secondo era di
 * nuovo in bacheca, dove nessuno gli ricordava i contanti. Dopo sette giorni
 * l'ordine spariva dalla sua vista e non poteva piu' rimediare.
 *
 * Qui stanno le regole, in un posto solo e senza React: quale passo viene
 * prima, dove si va dopo il codice giusto, quali ordini chiedono ancora
 * l'incasso. Le pagine del fattorino le chiamano; le prove le eseguono.
 */

import { compensoDalContante, contanteDaRimettereCents } from '@/lib/shipping';
import { formatPriceFromCents } from '@/lib/format';
import { vistaDaQuery, type LetturaQuery } from '@/lib/vista-query';

/** Il minimo che serve per decidere: come si paga, dov'e' l'ordine, se l'incasso c'e'. */
export type OrdinePerIncasso = {
  payment_method: string | null;
  delivery_status: string;
  cash_confirmed_at: string | null;
  pickup_in_store?: boolean | null;
};

/**
 * Gli stati in cui il fattorino ha in mano la merce o l'ha appena lasciata: e'
 * li' che l'incasso si dichiara. La stessa lista guarda la rotta che lo
 * registra (`app/api/rider/cash-confirm`), dentro la sua UPDATE.
 */
export const STATI_IN_CUI_SI_INCASSA = ['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;

/** Vero quando su questo ordine il fattorino deve ancora dichiarare i contanti. */
export function incassoDaDichiarare(o: OrdinePerIncasso): boolean {
  if (o.payment_method !== 'cod') return false;
  if (o.pickup_in_store) return false; // al banco incassa il negozio, non il fattorino
  if (o.cash_confirmed_at) return false;
  return (STATI_IN_CUI_SI_INCASSA as readonly string[]).includes(o.delivery_status);
}

/**
 * Cosa offre la barra in fondo alla pagina della consegna, ordine in strada:
 *  - `incasso`  → prima i contanti: il codice del cliente non si chiede ancora;
 *  - `codice`   → l'incasso c'e' (o si e' pagato con la carta): si chiude col codice.
 */
export function passoDellaConsegna(o: OrdinePerIncasso): 'incasso' | 'codice' {
  return incassoDaDichiarare(o) ? 'incasso' : 'codice';
}

/**
 * Dopo il codice giusto la pagina tornava da sola alla bacheca dopo un
 * secondo. Si torna solo se non resta niente da dichiarare: altrimenti si resta
 * sull'ordine, dove il pulsante dell'incasso e' in vista.
 *
 * Si guarda l'ordine COME DIVENTA (consegnato), non com'era: e' lo stato in
 * cui il fattorino lo lascia.
 */
export function dopoIlCodiceGiusto(o: OrdinePerIncasso): 'bacheca' | 'resta-sull-ordine' {
  return incassoDaDichiarare({ ...o, delivery_status: 'DELIVERED' }) ? 'resta-sull-ordine' : 'bacheca';
}

/**
 * Il motivo con cui il database rifiuta il codice quando l'incasso manca
 * (migrazione 163). Se la migrazione non e' ancora applicata non arriva mai, e
 * la pagina fa lo stesso ordine dei passi da sola.
 */
export const RIFIUTO_INCASSO_MANCANTE = 'CASH_NOT_CONFIRMED';

export const AVVISO_INCASSO_MANCANTE =
  'Prima conferma i contanti che hai ricevuto, poi chiedi il codice al cliente.';

/** Quando la consegna e' gia' chiusa e i contanti no. */
export const AVVISO_INCASSO_DOPO_LA_CONSEGNA =
  'Consegna chiusa. Ora conferma i contanti che hai ricevuto: senza, il negozio non viene pagato.';

/**
 * Gli ordini che il fattorino ha gia' consegnato e su cui manca ancora la
 * dichiarazione dei contanti: sono quelli che la bacheca gli rimette davanti.
 * Dal piu' vecchio: e' quello che il negozio aspetta da piu' tempo.
 */
export function incassiRimastiIndietro<T extends OrdinePerIncasso & { delivered_at?: string | null }>(
  righe: readonly T[],
): T[] {
  return righe
    .filter((r) => r.delivery_status === 'DELIVERED' && incassoDaDichiarare(r))
    .sort((a, b) => String(a.delivered_at ?? '').localeCompare(String(b.delivered_at ?? '')));
}

/** La chiave della cache e l'indirizzo della lettura che alimenta la bacheca. */
export const CHIAVE_INCASSI_DA_DICHIARARE = ['rider', 'incassi-da-dichiarare'] as const;
export const INDIRIZZO_INCASSI_DA_DICHIARARE = '/api/rider/incassi-da-dichiarare';

/**
 * 16/10/2026 — LE CIFRE DEL PANNELLO DEI CONTANTI, DA UNA FUNZIONE SOLA.
 *
 * La bacheca e la pagina dell'ordine passavano al pannello il compenso PIENO
 * (`compensoTrattenutoCents`), mentre il contante da rimettere toglieva solo
 * quello che il contante riusciva a coprire. Con un ordine quasi tutto pagato
 * col credito MyCity — 2 € in contanti, 3 € di compenso — il fattorino leggeva
 * «Previsto: 0,00 € — hai già trattenuto 3,00 € di compenso»: ne aveva tenuti
 * 2, e l'euro che manca gli arriva con i compensi sull'IBAN. Il conto a video
 * non tornava (0 + 3 non fa 2) e il bonifico dell'euro restava un mistero.
 *
 * Qui le tre cifre escono dalla stessa regola che scrive l'incasso
 * (`compensoDalContante`, usata da `campiDellIncasso`).
 */
export type CifreDellIncasso = {
  /** Il contante da rimettere. */
  expectedCents: number;
  /** Il compenso che il fattorino si e' tenuto davvero dal contante. */
  compensoTenutoCents: number;
  /** Il pezzo di compenso che il contante non copriva: arriva con i compensi sull'IBAN. */
  residuoDovutoCents: number;
};

export function cifreDellIncasso(o: Parameters<typeof compensoDalContante>[0]): CifreDellIncasso {
  const { trattenutoCents, residuoDovutoCents } = compensoDalContante(o);
  return { expectedCents: contanteDaRimettereCents(o), compensoTenutoCents: trattenutoCents, residuoDovutoCents };
}

/** La riga sotto l'importo, nel pannello dei contanti. */
export function fraseDelCompenso(c: CifreDellIncasso): string {
  let frase = `Previsto: ${formatPriceFromCents(c.expectedCents)}`;
  if (c.compensoTenutoCents > 0) {
    frase += ` — hai già trattenuto ${formatPriceFromCents(c.compensoTenutoCents)} di compenso.`;
  } else {
    frase += '.';
  }
  if (c.residuoDovutoCents > 0) {
    frase += c.compensoTenutoCents > 0
      ? ` Il resto del compenso, ${formatPriceFromCents(c.residuoDovutoCents)}, ti arriva sul tuo IBAN.`
      : ` Il tuo compenso, ${formatPriceFromCents(c.residuoDovutoCents)}, ti arriva sul tuo IBAN.`;
  }
  return frase;
}

/**
 * 16/10/2026 — «NESSUN INCASSO» E «NON LO SO» NON SONO LA STESSA COSA.
 *
 * La bacheca leggeva gli incassi da confermare prendendo solo il dato: se la
 * lettura falliva (la rotta risponde 500, la rete cade) il dato restava vuoto e
 * il riquadro non compariva. Il fattorino con due consegne in contanti mai
 * dichiarate leggeva una bacheca pulita e chiudeva la giornata: la rimessa
 * della sera saltava quegli ordini.
 *
 * Qui la lettura diventa uno di quattro stati, cosi' la pagina non puo'
 * confonderli:
 *  - `in-lettura` → nessun dato ancora: non si dice niente (il riquadro arriva
 *    appena la lettura risponde);
 *  - `nessuno`    → ho guardato e non c'e' niente da confermare;
 *  - `elenco`     → ci sono consegne da confermare;
 *  - `non-so`     → la lettura e' fallita: si dice, con «Riprova». Se c'era
 *    un elenco dall'ultima lettura riuscita resta sotto l'avviso, perche'
 *    quelle consegne con ogni probabilita' sono ancora da confermare.
 *
 * Un dato che non e' un elenco non e' un elenco vuoto: e' un «non so».
 */
export type RiquadroDegliIncassi<T> = {
  stato: 'in-lettura' | 'nessuno' | 'elenco' | 'non-so';
  /** Le consegne da mostrare: vuoto in lettura e quando non ce ne sono. */
  incassi: T[];
};

export function riquadroDegliIncassi<T>(lettura: LetturaQuery<unknown>): RiquadroDegliIncassi<T> {
  const dato = lettura.data;
  const eUnElenco = Array.isArray(dato);
  const ultimi = eUnElenco ? ([...dato] as T[]) : [];
  const datoStrano = dato !== undefined && dato !== null && !eUnElenco;
  const vista = vistaDaQuery(lettura, { quanti: ultimi.length });
  if (vista.mostraErrore || datoStrano) return { stato: 'non-so', incassi: ultimi };
  if (vista.mostraScheletro) return { stato: 'in-lettura', incassi: [] };
  if (vista.mostraVuoto) return { stato: 'nessuno', incassi: [] };
  return { stato: 'elenco', incassi: ultimi };
}
