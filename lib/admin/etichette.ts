/**
 * Etichette italiane per il pannello dell'amministratore.
 *
 * Le pagine admin stampavano i valori grezzi del database («cod · PENDING»,
 * «AWAITING_REMITTANCE», «available») o ripiegavano su parole false
 * («da sistema» per un autore umano). Qui le traduzioni stanno in un posto
 * solo, pure: nessuna rete, nessun React, una prova le esegue.
 */

/** Chi ha fatto un'azione del registro. Ogni riga ha un autore umano (lib/audit.ts). */
export function autoreDellaRiga(r: { actor_id: string | null; actor: { full_name: string | null } | null }): string {
  const nome = r.actor?.full_name?.trim();
  if (nome) return nome;
  // actor_id è NULL solo se l'account è stato cancellato (ON DELETE SET NULL).
  if (!r.actor_id) return 'account cancellato';
  return `utente senza nome (${r.actor_id.slice(0, 8)}…)`;
}

function etichetta(mappa: Record<string, string>, valore: string | null | undefined): string {
  if (!valore) return '—';
  return mappa[valore] ?? valore;
}

const METODO: Record<string, string> = { cod: 'contanti alla consegna', card: 'carta' };
const STATO_PAGAMENTO: Record<string, string> = {
  PENDING: 'in attesa',
  PAID: 'pagato',
  FAILED: 'fallito',
  REFUNDED: 'rimborsato',
  PARTIALLY_REFUNDED: 'rimborsato in parte',
};
// I valori ammessi da orders_payout_status_check (migrations/130).
const STATO_BONIFICO: Record<string, string> = {
  PENDING: 'in attesa',
  HELD: 'trattenuto',
  PROCESSING: 'in corso',
  TRANSFERRED: 'pagato al negozio',
  REFUNDED: 'rimborsato',
  FAILED: 'fallito',
  PENDING_SELLER_ONBOARDING: 'in attesa del conto del negozio',
  REVERSED: 'ripreso dal negozio',
  REVERSAL_FAILED: 'ripresa fallita: da recuperare a mano',
  AWAITING_REMITTANCE: 'in attesa dei contanti dal fattorino',
  CASH_IN_STORE: 'incassato in negozio',
};
// Il reclamo interno (internal_dispute_status) e il chargeback bancario (dispute_status).
const STATO_CONTESTAZIONE: Record<string, string> = {
  OPEN: 'aperta',
  RESOLVED: 'chiusa a favore del negozio',
  LOST: 'chiusa a favore del cliente',
  RIMBORSO_DA_RIPARTIRE: 'rimborso da ripartire',
  warning_needs_response: 'avviso della banca: serve una risposta',
  needs_response: 'la banca chiede una risposta',
  under_review: 'in esame dalla banca',
  won: 'vinta',
  lost: 'persa',
};
// I valori ammessi da products_status_check (migrations/071).
const STATO_PRODOTTO: Record<string, string> = {
  available: 'in vendita',
  sold: 'venduto',
  pending_approval: 'da approvare',
  draft: 'bozza',
  out_of_stock: 'senza scorta',
  sold_out: 'esaurito',
};

export const etichettaMetodo = (v: string | null | undefined) => etichetta(METODO, v);
export const etichettaStatoPagamento = (v: string | null | undefined) => etichetta(STATO_PAGAMENTO, v);
export const etichettaStatoBonifico = (v: string | null | undefined) => etichetta(STATO_BONIFICO, v);
export const etichettaContestazione = (v: string | null | undefined) => etichetta(STATO_CONTESTAZIONE, v);
export const etichettaStatoProdotto = (v: string | null | undefined) => etichetta(STATO_PRODOTTO, v);

const DATA_E_ORA = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

/** «4 nov 2026, 18:05» nell'ora di Piacenza, qualunque sia il fuso del browser. */
export function dataEOraPiacenza(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return DATA_E_ORA.format(d);
}

const PEZZI_CAMPO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/**
 * Da un istante del database al valore di un <input type="datetime-local">
 * («AAAA-MM-GGTHH:MM») nell'ora di Piacenza. `iso.slice(0, 16)` dava l'ora di
 * Greenwich: a ogni salvataggio l'evento slittava indietro di una o due ore.
 */
export function campoDataOraPiacenza(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(PEZZI_CAMPO.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * Dal valore di un campo datetime-local, letto come ora di Piacenza, all'istante
 * vero. Non dipende dal fuso del browser.
 */
export function istanteDaCampoPiacenza(campo: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(campo);
  if (!m) return null;
  const [, a, me, g, h, mi] = m.map(Number);
  const comeUtc = Date.UTC(a, me - 1, g, h, mi);
  // Lo scarto di Roma in quell'istante (1 o 2 ore): si prova, si corregge una volta.
  let t = comeUtc;
  for (let i = 0; i < 2; i++) {
    const visto = campoDataOraPiacenza(new Date(t));
    const v = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(visto)!.slice(1).map(Number);
    const vistoUtc = Date.UTC(v[0], v[1] - 1, v[2], v[3], v[4]);
    t += comeUtc - vistoUtc;
  }
  return new Date(t);
}
