import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { incassatoDellOrdineCents, metricheVenditore, type OrdinePerMetriche } from '@/lib/metriche-venditore';

/**
 * Il cliente paga 50 euro: 20 col credito MyCity, 30 in contanti al fattorino.
 *
 * La rotta dei contanti scrive `total_price` = 30 (la cassa del fattorino) e
 * `wallet_applied_cents` = 2000, ma commissione e quota del negozio le calcola
 * sui 50. Il cruscotto contava solo i 30: il negoziante vedeva 20 euro in meno
 * di quelli che riceve. Qui si prova che il credito torna dentro l'incassato, e
 * che le due pagine del venditore lo leggono davvero dal database.
 */

const contantiConCredito = (totale: number, creditoCents: number, extra: Partial<OrdinePerMetriche> = {}): OrdinePerMetriche => ({
  total_price: totale,
  wallet_applied_cents: creditoCents,
  delivery_status: 'DELIVERED',
  payment_status: 'PAID',
  application_fee_cents: 0,
  shipping_cost: 0,
  delivery_fee_cents: 0,
  refunded_amount_cents: 0,
  created_at: '2026-10-20T10:00:00Z',
  ...extra,
});

describe('il credito MyCity e pagamento vero', () => {
  it('50 euro pagati con 20 di credito: incassati 50, non 30', () => {
    expect(incassatoDellOrdineCents(contantiConCredito(30, 2000))).toBe(5000);
  });

  it('sotto i 10 euro, tutto col credito: incassati 8, non zero', () => {
    expect(incassatoDellOrdineCents(contantiConCredito(0, 800))).toBe(800);
  });

  it('senza credito il conto resta quello di prima (carta, 35 euro)', () => {
    expect(incassatoDellOrdineCents(contantiConCredito(35, 0))).toBe(3500);
    expect(incassatoDellOrdineCents({ ...contantiConCredito(35, 0), wallet_applied_cents: null })).toBe(3500);
  });

  it('il rimborso scende anche dalla parte pagata col credito, mai sotto zero', () => {
    expect(incassatoDellOrdineCents(contantiConCredito(30, 2000, { refunded_amount_cents: 1000 }))).toBe(4000);
    expect(incassatoDellOrdineCents(contantiConCredito(5, 500, { refunded_amount_cents: 99999 }))).toBe(0);
  });

  it('due negozi: il netto di ciascuno parte dal lordo, come la sua quota', () => {
    // Commissione 10% sui 50 = 5 euro; consegna 3 euro alla piattaforma.
    const m = metricheVenditore([
      contantiConCredito(30, 2000, { application_fee_cents: 500, delivery_fee_cents: 300 }),
      contantiConCredito(12, 0, { application_fee_cents: 120 }),
    ]);
    expect(m.incassatoCents).toBe(6200);
    expect(m.tuoNettoCents).toBe(6200 - 500 - 120 - 300);
  });
});

const RADICE = process.cwd();
/** Le colonne che una pagina chiede al database per la riga dell'ordine. */
function colonneLette(file: string): string[] {
  const src = readFileSync(join(RADICE, file), 'utf8');
  const m = src.match(/\.select\('([^']*total_price, delivery_status[^']*)'\)/);
  expect(m, `${file}: la lettura degli ordini non c'e' piu' con questa forma`).toBeTruthy();
  return m![1].split(',').map((c) => c.trim());
}

describe('le pagine del venditore leggono il credito', () => {
  for (const pagina of ['app/seller/dashboard/page.tsx', 'app/seller/analytics/page.tsx']) {
    it(`${pagina}: con le colonne che legge, 50 pagati con 20 di credito fanno 50`, () => {
      const colonne = colonneLette(pagina);
      const completo = contantiConCredito(30, 2000) as Record<string, unknown>;
      // La riga come arriva dal database: solo le colonne chieste.
      const comeArriva = Object.fromEntries(colonne.filter((c) => c in completo).map((c) => [c, completo[c]]));
      expect(metricheVenditore([comeArriva as OrdinePerMetriche]).incassatoCents).toBe(5000);
    });
  }
});
