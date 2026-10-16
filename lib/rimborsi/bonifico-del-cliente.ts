import { rimborsiGiaScritti } from '@/lib/stripe/elenco-dei-rimborsi';
import { centesimiDelBonificoDalSegno, eUnBonificoDiRimborso } from './bonifici-da-fare';

/**
 * IL BONIFICO CHE IL CLIENTE ASPETTA (riesame del 16/10, quarto giro).
 *
 * Sui contanti rimborsati col bonifico, `refundOrder` scrive «rimborsato» sull'ordine appena il
 * negozio (o chi amministra) decide: i soldi pero' li manda a mano una persona, dopo, e lo segna
 * con «Bonifico fatto». La pagina dell'ordine guardava solo lo stato del pagamento e diceva
 * «Ordine rimborsato.» dal primo minuto — mentre l'email diceva «per fare il bonifico ci serve il
 * tuo IBAN: scrivici». Chi leggeva la pagina pensava di avere gia' i soldi, e non scriveva.
 *
 * Qui si conta quello che manca: i bonifici registrati sull'ordine (il segno
 * `bonifico:<centesimi>:<chiave>` nell'elenco dei rimborsi, che scrive solo il server) che nessuno
 * ha ancora segnato fatti — sul reso (`refund_bonifico_fatto_at`) o nella riga del reclamo
 * (`bonifici_dei_reclami.fatto_at`). E se per uno di quelli non abbiamo l'IBAN.
 */
export interface BonificoDelCliente {
  /** Quanto deve ancora arrivare col bonifico, in centesimi. 0 = niente in sospeso. */
  daFareCents: number;
  /** Per almeno uno dei bonifici in sospeso non abbiamo l'IBAN: il cliente ce lo deve mandare. */
  serveIban: boolean;
  /**
   * Sappiamo davvero se i bonifici sono stati fatti? Senza la migrazione 162 il «fatto» non si
   * scrive da nessuna parte: la pagina non promette, rimanda all'assistenza. Lo stesso quando un
   * bonifico registrato sull'ordine non ha la riga dove il «fatto» si segna (riesame del 16/10,
   * quinto giro): per esempio il reclamo la cui riga in `bonifici_dei_reclami` non si e' scritta.
   */
  certo: boolean;
}

export interface RigaDelResoDelCliente {
  id: string;
  refund_bonifico_fatto_at?: string | null;
  refund_iban?: string | null;
}

export interface RigaDelReclamoDelCliente {
  dispute_id: string;
  fatto_at?: string | null;
  iban?: string | null;
}

/** La chiave di un segno `bonifico:<centesimi>:<chiave>`. */
function chiaveDelSegno(segno: string): string {
  return segno.replace(/^bonifico:\d+:/, '');
}

export function ilBonificoCheIlClienteAspetta(dati: {
  ordine: { stripe_refund_id?: string | null };
  resi: readonly RigaDelResoDelCliente[];
  reclami: readonly RigaDelReclamoDelCliente[];
  con162: boolean;
}): BonificoDelCliente {
  const resoPer = new Map(dati.resi.map((r) => [r.id, r]));
  const reclamoPer = new Map(dati.reclami.map((r) => [r.dispute_id, r]));
  let daFareCents = 0;
  let serveIban = false;
  // Riesame del 16/10, quinto giro — UN BONIFICO SENZA LA SUA RIGA NON SI PUO' DIRE «IN ARRIVO». Se
  // la riga del reclamo non si e' scritta (un guasto dopo il rimborso), nessuno potra' mai segnarla
  // fatta: la pagina diceva «in arrivo, ci serve il tuo IBAN» anche dopo il bonifico, per sempre.
  // Senza una riga, come senza la 162, la pagina non promette: rimanda all'assistenza.
  let senzaRiga = false;

  for (const segno of rimborsiGiaScritti(dati.ordine)) {
    if (!eUnBonificoDiRimborso(segno)) continue;
    const centesimi = centesimiDelBonificoDalSegno(segno);
    if (centesimi == null || centesimi <= 0) continue;
    const chiave = chiaveDelSegno(segno);

    if (chiave.startsWith('return_')) {
      const reso = resoPer.get(chiave.slice('return_'.length));
      if (dati.con162 && reso?.refund_bonifico_fatto_at) continue;
      daFareCents += centesimi;
      if (!reso) senzaRiga = true;
      else if (dati.con162 && !reso.refund_iban) serveIban = true;
      continue;
    }
    if (chiave.startsWith('dispute_')) {
      const riga = reclamoPer.get(chiave.slice('dispute_'.length));
      if (dati.con162 && riga?.fatto_at) continue;
      daFareCents += centesimi;
      // Il modulo del reclamo non chiede l'IBAN: finche' chi paga non lo copia sulla riga, manca.
      if (!riga) senzaRiga = true;
      else if (dati.con162 && !riga.iban) serveIban = true;
      continue;
    }
    // Un bonifico registrato da un'altra strada: nessuna riga dice se e' stato fatto.
    daFareCents += centesimi;
    senzaRiga = true;
  }

  return { daFareCents, serveIban, certo: dati.con162 && !senzaRiga };
}
