import type { SceltaContanti } from './regole-del-rimborso';

/**
 * LA SCELTA DEL CLIENTE SU COME RIAVERE I CONTANTI (R71).
 *
 * Chi paga alla consegna e restituisce un prodotto ha diritto ai soldi indietro
 * con lo stesso mezzo, salvo che scelga lui altrimenti (art. 56 del Codice del
 * Consumo). Prima il modulo di reso non chiedeva niente e il rimborso arrivava
 * d'ufficio come credito MyCity: chi restituiva un maglione da 40 € pagato al
 * fattorino si trovava 40 € spendibili solo con un altro ordine in contanti, e
 * nessuno gli aveva chiesto se li voleva cosi'.
 *
 * Adesso il modulo chiede «Come vuoi il rimborso?»: il bonifico e' la prima
 * scelta, con l'IBAN; il credito e' un'opzione che il cliente deve prendere
 * lui. Qui si controlla quello che arriva dal modulo, prima di salvarlo sul
 * reso. Funzioni pure.
 */

/** Quello che il modulo manda. Tutto facoltativo: un modulo vecchio non lo manda affatto. */
export interface SceltaInviata {
  modo: SceltaContanti;
  iban?: string | null;
}

/** La scelta, controllata e pronta da salvare sul reso. */
export type SceltaDelRimborso = { modo: 'BONIFICO'; iban: string } | { modo: 'CREDITO' };

export type EsitoDellaScelta =
  | { ok: true; scelta: SceltaDelRimborso | null }
  | { ok: false; errore: string };

/**
 * Lunghezza dell'IBAN nei paesi dell'area SEPA, gli unici su cui un bonifico in
 * euro parte senza costi per il cliente. Fonte: registro IBAN di SWIFT.
 */
const LUNGHEZZA_IBAN: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20,
  ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26,
  IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28,
  PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27, VA: 22,
};

/** L'IBAN come lo scrive una banca: maiuscole, senza spazi, trattini o punti. */
export function normalizzaIban(grezzo: string): string {
  return grezzo.toUpperCase().replace(/[\s.\-]/g, '');
}

/**
 * L'IBAN e' scritto giusto? Paese dell'area SEPA, lunghezza di quel paese, e il
 * controllo delle due cifre dopo il paese (ISO 13616, modulo 97): basta una
 * cifra sbagliata o due cifre scambiate perche' il conto non torni.
 */
export function ibanValido(grezzo: string): boolean {
  const iban = normalizzaIban(grezzo);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) return false;
  const lunghezza = LUNGHEZZA_IBAN[iban.slice(0, 2)];
  if (!lunghezza || iban.length !== lunghezza) return false;

  const riordinato = iban.slice(4) + iban.slice(0, 4);
  let resto = 0;
  for (const carattere of riordinato) {
    const valore = /[0-9]/.test(carattere) ? carattere : String(carattere.charCodeAt(0) - 55);
    for (const cifra of valore) resto = (resto * 10 + Number(cifra)) % 97;
  }
  return resto === 1;
}

/** Le ultime quattro cifre: quanto basta al cliente per riconoscere il suo conto. */
export function finaleIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const pulito = normalizzaIban(iban);
  return pulito.length >= 4 ? pulito.slice(-4) : null;
}

/**
 * Controlla la scelta arrivata dal modulo di reso.
 *
 *  · Ordine pagato con carta: non c'e' niente da scegliere, il rimborso torna
 *    sulla carta. Qualunque cosa arrivi si ignora.
 *  · Contanti, modulo che non manda la scelta (una pagina rimasta aperta da
 *    prima): il reso si apre lo stesso — il recesso non si blocca per un campo —
 *    e il rimborso andra' col bonifico, chiedendo l'IBAN al cliente.
 *  · Contanti, credito: e' la scelta espressa che la legge chiede.
 *  · Contanti, bonifico: serve un IBAN scritto giusto.
 */
export function leggiSceltaDelRimborso(
  inviata: SceltaInviata | null | undefined,
  ordine: { pagatoInContanti: boolean },
): EsitoDellaScelta {
  if (!ordine.pagatoInContanti || !inviata) return { ok: true, scelta: null };
  if (inviata.modo === 'CREDITO') return { ok: true, scelta: { modo: 'CREDITO' } };

  const iban = normalizzaIban(inviata.iban ?? '');
  if (!iban) {
    return { ok: false, errore: "Scrivi l'IBAN del conto su cui vuoi ricevere il rimborso." };
  }
  if (!ibanValido(iban)) {
    return {
      ok: false,
      errore:
        "Questo IBAN non torna: controlla lettere e cifre. Un IBAN italiano comincia con IT e ha 27 caratteri.",
    };
  }
  return { ok: true, scelta: { modo: 'BONIFICO', iban } };
}

/** Le colonne del reso che portano la scelta (migrazione 162). */
export function colonneDellaScelta(scelta: SceltaDelRimborso | null): {
  refund_method?: SceltaContanti;
  refund_iban?: string | null;
} {
  if (!scelta) return {};
  if (scelta.modo === 'CREDITO') return { refund_method: 'CREDITO', refund_iban: null };
  return { refund_method: 'BONIFICO', refund_iban: scelta.iban };
}

/** Le colonne che nascono con la migrazione 162: prima della firma il database non le ha. */
export const COLONNE_162 = ['refund_method', 'refund_iban', 'refund_bonifico_cents', 'refund_bonifico_fatto_at'] as const;
