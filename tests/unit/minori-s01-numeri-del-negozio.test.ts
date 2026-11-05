import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ordiniPerOra } from '@/app/seller/analytics/letture-dell-andamento';
import { ordineContaNelFatturato, pezziVenduti } from '@/lib/metriche-venditore';
import { incassoPerGiorno } from '@/lib/guadagni/giorni';
import { avvisoDelTettoOrdini, TETTO_ORDINI_LETTI } from '@/lib/guadagni/tetto-ordini';
import { oraPiacenza } from '@/lib/tempo-piacenza';

/** S01 — i numeri che il negozio legge nelle sue pagine. */
const leggi = (p: string) => readFileSync(p, 'utf8');

describe('651 — le ore di punta contano solo gli ordini pagati e non annullati', () => {
  it('tre ordini rifiutati alle 19 non fanno delle 19 l\'ora di punta', () => {
    const alle = (ora: number, extra: Record<string, unknown>) => ({
      created_at: `2026-11-03T${String(ora - 1).padStart(2, '0')}:10:00.000Z`, // 1 ora indietro: CET
      total_price: 10,
      ...extra,
    });
    const ordini = [
      alle(19, { delivery_status: 'CANCELED', payment_status: 'PAID' }),
      alle(19, { delivery_status: 'CANCELED', payment_status: 'PAID' }),
      alle(19, { delivery_status: 'PENDING', payment_status: 'PENDING' }),
      alle(11, { delivery_status: 'DELIVERED', payment_status: 'PAID' }),
    ];
    const conti = ordiniPerOra(ordini, ordineContaNelFatturato, oraPiacenza);
    expect(conti[19]).toBe(0);
    expect(conti[11]).toBe(1);
  });
  it('la pagina Analisi usa ordiniPerOra', () => {
    expect(leggi('app/seller/analytics/page.tsx')).toContain('ordiniPerOra(orders');
  });
});

describe('653 — «Articoli venduti» conta i pezzi', () => {
  it('sei cornetti in una riga sono sei', () => {
    expect(pezziVenduti([{ quantity: 6 }, { quantity: 1 }])).toBe(7);
  });
  it('una riga senza quantità vale uno', () => {
    expect(pezziVenduti([{}, { quantity: null }])).toBe(2);
  });
  it('il cruscotto legge la quantità e usa pezziVenduti', () => {
    const s = leggi('app/seller/dashboard/page.tsx');
    expect(s).toContain("select('id, quantity, orders!inner");
    expect(s).toContain('quanti: pezziVenduti(itemsArr)');
  });
});

describe('268 — il grafico dei guadagni usa l\'incassato al netto dei rimborsi', () => {
  it('un ordine da 20 € rimborsato per 15 vale 5 nel grafico', () => {
    const adesso = new Date('2026-11-04T12:00:00.000Z');
    const giorni = Object.fromEntries(
      incassoPerGiorno([{ created_at: '2026-11-04T10:00:00.000Z', total_price: 20, refunded_amount_cents: 1500 }], 7, adesso),
    );
    expect(giorni['2026-11-04']).toBe(5);
  });
  it('la pagina passa al grafico solo gli ordini attivi', () => {
    expect(leggi('app/seller/earnings/page.tsx')).toContain('incassoPerGiorno(activeCard)');
  });
});

describe('272 — Guadagni e Clienti dicono quando si fermano agli ultimi 500 ordini', () => {
  it('sotto il tetto niente avviso, al tetto sì', () => {
    expect(avvisoDelTettoOrdini(499)).toBeNull();
    expect(avvisoDelTettoOrdini(TETTO_ORDINI_LETTI)).toContain('ultimi 500 ordini');
  });
  it('tutte e due le pagine mostrano l\'avviso', () => {
    expect(leggi('app/seller/earnings/page.tsx')).toContain('avvisoDelTettoOrdini(orders.length)');
    expect(leggi('app/seller/customers/page.tsx')).toContain('avvisoDelTettoOrdini(');
  });
});

describe('267 / 340 — Analisi e cruscotto dicono quello che misurano', () => {
  const analisi = leggi('app/seller/analytics/page.tsx');
  it('il netto si chiama netto, non fatturato', () => {
    expect(analisi).not.toContain('>Fatturato 30 giorni<');
    expect(analisi).toContain('Il tuo netto (30 giorni)');
  });
  it('dalle visite non si dice «vende poco», e niente «sotto la media» senza media', () => {
    expect(analisi).not.toMatch(/vende poco`/);
    expect(analisi).not.toContain('Conversione sotto la media');
  });
  it('il consiglio di sponsorizzare segue l\'interruttore', () => {
    expect(analisi).toMatch(/if \(best && ABBONAMENTO_NEGOZI_ACCESO\)/);
  });
  it('niente numeri senza fonte nel cruscotto e nel Centro venditori', () => {
    expect(leggi('app/seller/dashboard/page.tsx')).not.toContain('vendono il 70% in più');
    expect(leggi('app/seller/help/domande.ts')).not.toContain('fiducia del 30%');
  });
});

describe('189 — l\'amministratore nel cruscotto del negozio non resta sullo scheletro', () => {
  it('prima dello scheletro c\'è il ramo dell\'amministratore', () => {
    const s = leggi('app/seller/dashboard/page.tsx');
    const admin = s.indexOf('if (isAdmin) {');
    const scheletro = s.indexOf('if (vista.mostraScheletro) return <LoadingState />;');
    expect(admin).toBeGreaterThan(0);
    expect(admin).toBeLessThan(scheletro);
  });
});
