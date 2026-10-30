/**
 * 30/10/2026 — DOPO UN ANNULLO NEL CARRELLO, IL CLIENTE SA COSA CAMBIA. CON LE CIFRE.
 *
 * La regola di Nicola (registro dei fatti, consegna.negozio-che-rifiuta, 30/10 00:35): se in un
 * carrello con più negozi un ordine se ne va prima della consegna — il negozio rifiuta, non
 * conferma in tempo, o lo annullano il cliente o l'amministrazione — la consegna si rifà sui
 * negozi rimasti con la stessa regola. Pane 15 € e frutta 12 €, il forno rifiuta: la frutta passa
 * da 13 € a 15 €, e dell'ordine del pane (18 €) al cliente ne tornano 16.
 *
 * Il conto lo faceva già `ricalcolaLaConsegnaDelGiro` (lib/ordini/annulla.ts). Il cliente però non
 * lo sapeva: con i contanti il fattorino chiedeva 15 € dove la conferma diceva 13, con la carta
 * arrivava un rimborso di 16 € senza spiegazione. Queste righe finiscono nell'email di annullo e
 * nella campanella; quelle per gli amministratori nell'avviso di chi chiude un rimborso a mano.
 *
 * Solo testo, nessuna lettura: le cifre arrivano da chi ha scritto il carrello, quindi sono quelle
 * scritte nel database, non un secondo conto che potrebbe divergere.
 */

/** Un ordine del carrello che resta, con la consegna e il totale prima e dopo il ricalcolo. */
export type OrdineRimasto = {
  ordineId: string;
  consegnaPrimaCents: number;
  consegnaCents: number;
  totalePrimaCents: number;
  totaleCents: number;
};

export type AvvisoDelCarrello = {
  /** L'ordine che se ne va. */
  ordineId: string;
  /** Il suo totale prima del ricalcolo: quello della conferma. */
  pagatoCents: number;
  /** Il suo totale dopo: quanto torna sulla carta, o quanto non si paga alla porta. */
  tornaCents: number;
  /** La parte di consegna dentro `tornaCents`: la differenza che resta su di lui. */
  consegnaCents: number;
  /** La merce dentro `tornaCents`; null se c'è di mezzo credito o spedizione e non si sa dire pulita. */
  spesaCents: number | null;
  /** Quanti negozi restano nel giro. */
  negoziRimasti: number;
  rimasti: OrdineRimasto[];
};

/** Come stanno i soldi del carrello: rimborsati sulla carta, da pagare alla porta, o mai pagati. */
export type ComeHaPagato = 'carta' | 'contanti' | 'da-pagare';

export function euro(cents: number): string {
  const v = Math.round(cents) / 100;
  return `${Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')} €`;
}

const numero = (id: string) => `#${id.slice(0, 6).toUpperCase()}`;

/** Le righe per il cliente: una per l'ordine che se ne va, una per ogni ordine che resta. */
export function righeDelCarrello(a: AvvisoDelCarrello, come: ComeHaPagato): string[] {
  const quanto =
    come === 'carta' ? `ti tornano ${euro(a.tornaCents)} sulla carta` : `non paghi i suoi ${euro(a.tornaCents)}`;
  const cioe = a.spesaCents != null ? `, cioè ${euro(a.spesaCents)} di spesa e ${euro(a.consegnaCents)} di consegna` : '';
  const perche =
    a.negoziRimasti === 1 ? 'perché ora il giro passa da un negozio solo' : `perché ora il giro passa da ${a.negoziRimasti} negozi`;
  const righe = [`L'ordine ${numero(a.ordineId)} è annullato: ${quanto}${cioe}.`];
  for (const r of a.rimasti) {
    const cambia = r.totaleCents !== r.totalePrimaCents || r.consegnaCents !== r.consegnaPrimaCents;
    const invece = r.totaleCents !== r.totalePrimaCents ? ` invece di ${euro(r.totalePrimaCents)}` : '';
    const paga =
      come === 'carta'
        ? `quell'ordine resta pagato, ${euro(r.totaleCents)}`
        : come === 'contanti'
          ? `alla porta paghi ${euro(r.totaleCents)}${invece}`
          : `il suo totale è ${euro(r.totaleCents)}${invece}`;
    righe.push(
      cambia
        ? `La consegna dell'ordine ${numero(r.ordineId)} ora è ${euro(r.consegnaCents)} invece di ${euro(r.consegnaPrimaCents)}, ${perche}: ${paga}.`
        : `L'ordine ${numero(r.ordineId)} non cambia: ${paga}.`,
    );
  }
  return righe;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Lo stesso, in HTML: un paragrafo per riga. */
export function htmlDelCarrello(a: AvvisoDelCarrello, come: ComeHaPagato): string {
  return righeDelCarrello(a, come)
    .map((r) => `<p style="margin:0 0 12px">${escapeHtml(r)}</p>`)
    .join('');
}

/**
 * Per chi chiude a mano un rimborso che non è partito: il carrello è GIÀ riscritto. Senza, chi
 * legge «controlla su Stripe» rende il totale vecchio (18 € invece di 16) e lascia la frutta a 15.
 */
export function righePerChiChiudeAMano(a: AvvisoDelCarrello): string {
  const altri = a.rimasti
    .map(
      (r) =>
        `${numero(r.ordineId)}: consegna ${euro(r.consegnaCents)} (era ${euro(r.consegnaPrimaCents)}), ` +
        `totale ${euro(r.totaleCents)} (era ${euro(r.totalePrimaCents)})`,
    )
    .join('; ');
  return (
    'Attenzione: la consegna degli altri ordini dello stesso carrello è già stata rifatta sui negozi rimasti. ' +
    `Per questo ordine il conto nuovo è ${euro(a.tornaCents)} (era ${euro(a.pagatoCents)}): non rendere il totale vecchio. ` +
    `Gli altri ordini: ${altri}.`
  );
}
