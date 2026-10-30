import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 30/10/2026 — I TERMINI DICONO QUELLO CHE L'ANNULLO RENDE DAVVERO.
 *
 * Prima le prove dei Termini cercavano parole nel sorgente: tre parole nel §4 di app/terms/page.tsx
 * e una riga di annulla.ts con una regex. Un §4 riscritto «ti torna tutto quello che hai pagato per
 * lui, anche se nel carrello c'erano altri Venditori… la differenza della consegna la copre MyCity»
 * restava verde, e il §6 prometteva il rimborso «per intero, spese di consegna comprese» anche
 * quando in un carrello con più negozi torna la merce più la differenza della consegna (16 € su 18).
 *
 * Qui si disegna la pagina vera dei Termini e si guarda cosa dice; poi, per ogni caso che dice,
 * si annulla davvero con `annullaERimborsa` su un database finto e si confronta quello che torna.
 * Se il testo cambia a mano, o il codice smette di fare quello che il testo dice, si diventa rossi.
 */

// Come il vero `refundOrder`: annulla l'ordine e scrive il rimborsato, così un secondo annullo
// dello stesso carrello vede il primo.
const refundOrder = vi.fn(async (a: { orderId: string; amountCents: number }) => {
  const r = db.tabelle.orders.find((x) => x.id === a.orderId);
  if (r) Object.assign(r, { delivery_status: 'CANCELED', refunded_amount_cents: Number(r.refunded_amount_cents ?? 0) + a.amountCents });
  return { refundId: 're_1' };
});
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: { orderId: string; amountCents: number }) => refundOrder(a) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { finto, carrello, tentativoDiCassa } from './carrello-finto';
import { annullaERimborsa } from '@/lib/ordini/annulla';
import TermsPage from '@/app/terms/page';
import {
  COSA_TORNA,
  esempioDelCarrello,
  fraseDelCaso,
  type CasoDelCarrello,
} from '@/lib/legal/promessa-cliente-assente';

const html = renderToStaticMarkup(TermsPage());
const inChiaro = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
function sezione(id: string, finoA: string): string {
  const inizio = html.indexOf(`id="${id}"`);
  const fine = html.indexOf(`id="${finoA}"`, inizio);
  expect(inizio, `la sezione ${id} non c'è nella pagina disegnata`).toBeGreaterThan(-1);
  expect(fine).toBeGreaterThan(inizio);
  return inChiaro(html.slice(inizio, fine));
}
const s4 = sezione('ordini', 'pagamenti');
const s6 = sezione('consegne', 'recesso');

const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;
const resi = () => refundOrder.mock.calls.reduce((s, c) => s + c[0].amountCents, 0);
beforeEach(() => {
  refundOrder.mockClear();
});

/** Annulla davvero il caso e dice cosa è tornato: tutto quello pagato, o merce più differenza. */
async function annulla(caso: CasoDelCarrello) {
  const due = caso !== 'carrello-di-un-negozio';
  const ordini = due ? carrello(['pane', 'frutta'], [1500, 1200], 'card') : carrello(['pane'], [1500], 'card');
  if (caso === 'altri-gia-consegnati') ordini[1].delivery_status = 'DELIVERED';
  const addebitato = ordini.reduce((s, o) => s + o.gross_total_cents, 0);
  const pagatoPane = ordini[0].gross_total_cents;
  db = finto({ orders: ordini });
  await annullaERimborsa(db as never, { ...riga('pane') } as never, { reason: 'Rifiutato dal negozio' });
  if (caso === 'tutto-il-carrello') {
    await annullaERimborsa(db as never, { ...riga('frutta') } as never, { reason: 'Rifiutato dal negozio' });
    return resi() === addebitato ? 'tutto' : 'merce-e-differenza';
  }
  // Niente si perde per strada: quello che torna più quello che resta da pagare è l'addebitato.
  const resta = due && caso !== 'altri-gia-consegnati' ? Math.round(Number(riga('frutta').total_price) * 100) : due ? ordini[1].gross_total_cents : 0;
  expect(resi() + resta).toBe(addebitato);
  return resi() === pagatoPane ? 'tutto' : 'merce-e-differenza';
}

describe('ogni caso che i Termini dicono, l annullo lo rende davvero', () => {
  for (const caso of Object.keys(COSA_TORNA) as CasoDelCarrello[]) {
    it(`${caso}: torna «${COSA_TORNA[caso]}», come dice il §6`, async () => {
      expect(await annulla(caso)).toBe(COSA_TORNA[caso]);
      expect(s6).toContain(fraseDelCaso(caso));
    });
  }

  it('il §4 (rifiuto del negozio) dice i due casi che possono capitare prima dell accettazione', () => {
    expect(s4).toContain(fraseDelCaso('carrello-di-un-negozio'));
    expect(s4).toContain(fraseDelCaso('altri-da-consegnare'));
    expect(s4).not.toMatch(/rimborsat[oa] (integralmente|per intero)|rimborso (integrale|completo|totale)/i);
  });

  it('l esempio di §4 e §6 ha le cifre che il codice rende: pane 15 + frutta 12, il forno rifiuta', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card');
    const prima = { pane: ordini[0].gross_total_cents, frutta: ordini[1].gross_total_cents };
    db = finto({ orders: ordini });
    await annullaERimborsa(db as never, { ...riga('pane') } as never, { reason: 'Rifiutato dal negozio' });
    const vere = {
      pagatoCents: prima.pane,
      tornaCents: refundOrder.mock.calls[0][0].amountCents,
      altroPrimaCents: prima.frutta,
      altroDopoCents: Math.round(Number(riga('frutta').total_price) * 100),
      consegnaDopoCents: Number(riga('frutta').delivery_fee_cents),
    };
    expect(vere.tornaCents).toBeLessThan(vere.pagatoCents);
    expect(s4).toContain(esempioDelCarrello(vere));
    expect(s6).toContain(esempioDelCarrello(vere));

    // Coi contanti la frutta alla porta costa quello che l'esempio dice.
    const contanti = carrello(['pane', 'frutta'], [1500, 1200], 'cod');
    db = finto({ orders: contanti, cod_checkout_attempts: tentativoDiCassa(['pane', 'frutta']) });
    await annullaERimborsa(db as never, { ...riga('pane') } as never, { reason: 'Rifiutato dal negozio' });
    expect(Math.round(Number(riga('frutta').total_price) * 100)).toBe(vere.altroDopoCents);
  });

  it('si rende il residuo: un ordine già rimborsato di 5 € ne rende 5 in meno, consegna compresa', async () => {
    const ordini = carrello(['pane'], [1500], 'card');
    ordini[0].refunded_amount_cents = 500;
    db = finto({ orders: ordini });
    await annullaERimborsa(db as never, { ...riga('pane') } as never, { reason: 'annullo' });
    expect(refundOrder.mock.calls[0][0].amountCents).toBe(ordini[0].gross_total_cents - 500);
  });
});
