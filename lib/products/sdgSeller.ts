/**
 * SDG AGENZIA NEL MARKETPLACE — venditore di sistema coi tre abbonamenti ai servizi.
 *
 * 24/11/2026 — Nicola: «metti i tre abbonamenti come prodotti nella vetrina di SDG».
 * I servizi sono di MyCity e li realizza SDG Agenzia, il partner (`REALIZZATI_DA` in
 * lib/agenzia/preventivo.ts). SDG è un negozio di sistema come «MyCity»
 * (lib/products/mycitySeller.ts): UUID fisso, utente fittizio che non entra mai,
 * email .local. Lo stesso UUID lo crea la migrazione 707.
 *
 * I SUOI PRODOTTI NON SI COMPRANO COL CARRELLO. Un abbonamento non è un ordine con
 * la consegna: si attiva dalla pagina Abbonamento del negozio (/seller/abbonamento), che paga
 * con Stripe in abbonamento. Il carrello, la cassa con la carta e quella in contanti
 * li rifiutano (`validaRigaDelCarrello`, lib/ordini/valida-carrello.ts), e la pagina
 * prodotto al posto di «Aggiungi al carrello» porta alla pagina Abbonamento.
 */
import { PERCORSO_ABBONAMENTO } from '@/lib/agenzia/indirizzi-servizi';
import { PAGAMENTO_ONLINE_SERVIZI } from '@/lib/agenzia/pagamento-servizi';

export const SDG_SELLER_ID = '11111111-1111-1111-1111-5d9000000001';

export const SDG_STORE_NAME = 'SDG Agenzia';

/** Vero se il negozio è SDG: i suoi prodotti sono abbonamenti, non merce. */
export function eDiSdg(sellerId: string | null | undefined): boolean {
  return typeof sellerId === 'string' && sellerId.trim().toLowerCase() === SDG_SELLER_ID;
}

/**
 * Dove porta il pulsante di un abbonamento nella pagina prodotto: chi ha un negozio
 * va alla sua pagina Abbonamento, dove sceglie e paga; chi non lo ha, prima si iscrive.
 */
export function doveSiAttivaLAbbonamento(chiGuardaEUnNegozio: boolean, giaAbbonato: boolean | null = false): { href: string; testo: string } {
  // 28/11/2026 — Un negozio che ha già l'abbonamento non sceglie di nuovo: va a vedere il suo. Finché non si sa
  // (lettura in corso o non riuscita, `null`) il pulsante non promette una scelta: porta alla pagina e basta.
  if (chiGuardaEUnNegozio && giaAbbonato === true) return { href: PERCORSO_ABBONAMENTO, testo: 'Vedi il tuo abbonamento' };
  if (chiGuardaEUnNegozio && giaAbbonato === null) return { href: PERCORSO_ABBONAMENTO, testo: 'Vai alla pagina Abbonamento della tua attività' };
  return chiGuardaEUnNegozio
    ? { href: PERCORSO_ABBONAMENTO, testo: 'Scegli l’abbonamento dalla tua attività' }
    : { href: '/sell', testo: 'Iscrivi la tua attività per attivarlo' };
}

/**
 * Il messaggio di chi prova a mettere un abbonamento nel carrello o in cassa. 27/11/2026 — Nicola, 26/11 verso
 * le 16:00: per ora si paga in contanti e il pagamento online è spento (lib/agenzia/pagamento-servizi.ts):
 * finché è spento, il messaggio non dice che «si attiva» dal sito, come la descrizione dei prodotti (migrazione 999e).
 */
export const MESSAGGIO_ABBONAMENTO_NON_IN_CARRELLO = PAGAMENTO_ONLINE_SERVIZI
  ? 'è un abbonamento ai servizi: non si compra col carrello, si attiva dalla pagina Abbonamento del tuo negozio.'
  : 'è un abbonamento ai servizi: non si compra col carrello, lo chiedi dalla pagina Abbonamento della tua attività e, per ora, si paga in contanti, di persona.';
