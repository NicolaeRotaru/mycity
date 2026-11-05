import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { veloceSiPuo } from '@/lib/ordini/consegna-veloce';
import { ORDER_STATUS_COLOR } from '@/lib/order-status';
import OrderTimeline from '@/components/OrderTimeline';

/**
 * Sessione S02 (5/11/2026) — schede piccole.
 *  · 163:  la veloce non si vende nell'ultimo quarto d'ora prima della chiusura;
 *  · 2325: il no della veloce dice le ore dalle costanti, non scritte a mano;
 *  · 1528: la riga della timeline dice READY con la stessa etichetta della targhetta;
 *  · 850:  gli sfondi dei bollini di stato vengono dai token;
 *  · 74:   il riquadro dell'IBAN del fattorino guarda solo stripe_payouts_enabled.
 */
const FORNO_LUN = { mon: [['09:00', '13:00'], ['16:30', '19:30']] };
// Lunedì 2/11/2026 (ora solare): le Date sono già «ora di Piacenza», come romeNow().
const alle = (h: number, m: number) => new Date(2026, 10, 2, h, m);

describe('163 · la veloce e la chiusura del negozio', () => {
  it('alle 19:16, col forno che chiude alle 19:30: no', () => {
    const e = veloceSiPuo({ adesso: alle(19, 16), negozi: [{ nome: 'Pane Quotidiano', orari: FORNO_LUN }], fattoriniOnline: 1 });
    expect(e.possibile).toBe(false);
  });
  it('alle 19:10 (venti minuti prima): sì', () => {
    const e = veloceSiPuo({ adesso: alle(19, 10), negozi: [{ nome: 'Pane Quotidiano', orari: FORNO_LUN }], fattoriniOnline: 1 });
    expect(e.possibile).toBe(true);
  });
  it('alle 12:50, con la pausa dalle 13: no', () => {
    const e = veloceSiPuo({ adesso: alle(12, 50), negozi: [{ nome: 'Pane Quotidiano', orari: FORNO_LUN }], fattoriniOnline: 1 });
    expect(e.possibile).toBe(false);
  });
});

describe('2325 · le ore della veloce hanno una casa sola', () => {
  it('il no fuori orario dice le ore delle costanti, e il sorgente non le scrive a mano', () => {
    const e = veloceSiPuo({ adesso: alle(22, 0), negozi: [], fattoriniOnline: 1 });
    expect(e.possibile).toBe(false);
    if (!e.possibile) expect(e.perche).toContain('dalle 8 alle 21');
    expect(readFileSync('lib/ordini/consegna-veloce.ts', 'utf8')).not.toContain('si fa dalle 8 alle 21');
  });
});

describe('1528 · «Pronto» nella timeline', () => {
  it('a domicilio dice «Pronto per il rider» come la targhetta; col ritiro «Pronto per il ritiro»', () => {
    const a = renderToStaticMarkup(createElement(OrderTimeline, { status: 'READY', readyAt: '2026-11-02T10:00:00Z' }));
    expect(a).toContain('Pronto per il rider');
    expect(a).not.toContain('Pronto per il ritiro');
    const b = renderToStaticMarkup(createElement(OrderTimeline, { status: 'READY', readyAt: '2026-11-02T10:00:00Z', ritiroInNegozio: true }));
    expect(b).toContain('Pronto per il ritiro');
    expect(readFileSync('app/seller/orders/[id]/page.tsx', 'utf8')).not.toContain("'Pronto per il ritiro' : 'Pronto per il rider'");
  });
});

describe('850 · gli sfondi di stato sono token', () => {
  it('ogni sfondo è un var(--status-*-bg) definito in app/globals.css', () => {
    const css = readFileSync('app/globals.css', 'utf8');
    for (const { bg } of Object.values(ORDER_STATUS_COLOR)) {
      const nome = /^var\((--status-[a-z]+-bg)\)$/.exec(bg)?.[1];
      expect(nome, bg).toBeTruthy();
      expect(css).toContain(`${nome}:`);
    }
  });
});

describe('74 · il riquadro dell IBAN del fattorino', () => {
  it('è attivo con stripe_payouts_enabled, senza pretendere charges_enabled', () => {
    const src = readFileSync('components/rider/RiderConnectButton.tsx', 'utf8');
    expect(src).toContain('const isActive = !!status?.stripe_payouts_enabled;');
    expect(src).not.toContain('stripe_charges_enabled && !!status?.stripe_payouts_enabled');
  });
});

describe('262 · il file degli ordini per il commercialista', () => {
  it('ha venduto lordo (col credito, zero sugli annullati), metodo, stato pagamento, rimborsato e lo stato in italiano', async () => {
    const { rigaCsvOrdine, INTESTAZIONI_CSV_ORDINI } = await import('@/lib/ordini/esporta-ordini');
    const base = { created_at: '2026-11-02T10:00:00Z', delivery_full_name: 'Maria', delivery_city: 'Piacenza', seller: null, rider: null };
    const col = (nome: string) => INTESTAZIONI_CSV_ORDINI.indexOf(nome as never);
    const conCredito = rigaCsvOrdine({ ...base, id: 'o1', delivery_status: 'DELIVERED', total_price: 15, wallet_applied_cents: 500, payment_method: 'cod', payment_status: 'PAID', refunded_amount_cents: 0 });
    const annullato = rigaCsvOrdine({ ...base, id: 'o2', delivery_status: 'CANCELED', total_price: 10, payment_method: 'cod', payment_status: 'PENDING' });
    expect(conCredito[col('Venduto lordo €')]).toBe('20,00');
    expect(annullato[col('Venduto lordo €')]).toBe('0,00');
    expect(annullato[col('Stato')]).toBe('Annullato');
    expect(conCredito[col('Metodo')]).toBe('Contanti alla consegna');
    expect(annullato[col('Stato pagamento')]).toBe('Da incassare');
    expect(conCredito[col('Rimborsato €')]).toBe('0,00');
  });
});

describe('157 · l etichetta di spedizione e i nomi con lettere rumene', () => {
  it('riduce a WinAnsi il testo libero: «ț» diventa «t», l emoji sparisce, le accentate italiane restano', async () => {
    const { testoPerEtichetta } = await import('@/lib/shipping-etichetta/testo-winansi');
    expect(testoPerEtichetta('Ionuț Popescu')).toBe('Ionut Popescu');
    expect(testoPerEtichetta('Ștefan Țurcanu')).toBe('Stefan Turcanu');
    expect(testoPerEtichetta('citofono 🔔')).toBe('citofono');
    expect(testoPerEtichetta('Perché è là, città — 3°')).toBe('Perché è là, città — 3°');
    const src = readFileSync('lib/shipping-etichetta/label.ts', 'utf8');
    for (const campo of ['data.recipientName', 'data.street', 'data.notes.slice(0, 200)']) expect(src).toContain(`testoPerEtichetta(${campo})`);
  });
});

describe('2612 · 2669 · il pulsante SOS', () => {
  it('distingue «non avvisata» da «non si sa ancora», e accetta una posizione recente', () => {
    const src = readFileSync('components/rider/SOSButton.tsx', 'utf8');
    expect(src).toContain('Non sappiamo ancora se MyCity è stata avvisata');
    expect(src).toContain('maximumAge: 60_000');
  });
});

describe('1551 · la mappa sul telefono', () => {
  it('col dito la mappa si accende con un tocco e lo dice; un tocco fuori la rispegne', () => {
    const src = readFileSync('components/DeliveryMap.tsx', 'utf8');
    expect(src).toContain('Tocca la mappa per spostarla');
    expect(src).toContain('map.dragging.enable();');
    expect(src).toContain('map.dragging.disable();');
  });
});

describe('1589 · il codice sconto nei contanti passa dalla stessa porta della carta', () => {
  it('la rotta dei contanti usa rivendicaIlCodiceSconto(riserveLiberate, …) e non chiama più claim_coupon a mano', () => {
    const src = readFileSync('app/api/orders/cod/route.ts', 'utf8');
    expect(src).toContain('await rivendicaIlCodiceSconto(\n        riserveLiberate,');
    expect(src).not.toContain("rpc('claim_coupon'");
    expect(src).not.toMatch(/validateCoupon\(/);
  });
});
