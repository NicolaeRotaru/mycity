import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pagamentiPronti, prodottiPubblicati, ETICHETTA_PAGAMENTI } from '@/components/seller/pronto-a-incassare';

/**
 * S06 · 314 — Sulla bacheca la lista «Completa il tuo negozio» e il punteggio
 * dicono la stessa cosa su prodotti pubblicati e pagamenti.
 */
describe('314 — una regola sola', () => {
  it('pagamenti: IBAN o Stripe', () => {
    expect(pagamentiPronti({ billing_iban: 'IT60X0542811101000000123456' })).toBe(true);
    expect(pagamentiPronti({ stripe_charges_enabled: true })).toBe(true);
    expect(pagamentiPronti({ billing_iban: '  ' })).toBe(false);
    expect(pagamentiPronti(null)).toBe(false);
  });
  it('tre bozze non sono tre prodotti pubblicati', () => {
    expect(prodottiPubblicati([{ status: 'draft' }, { status: 'draft' }, { status: 'sold' }, { status: 'available' }])).toBe(1);
  });
  it('i due riquadri usano la stessa regola e nessuno dice «su Stripe»', () => {
    for (const p of ['components/seller/SellerOnboardingChecklist.tsx', 'components/seller/SellerHealthScore.tsx']) {
      const s = readFileSync(p, 'utf8');
      expect(s, p).toContain('pagamentiPronti(');
      expect(s, p).toContain('ETICHETTA_PAGAMENTI');
      expect(s, p).not.toMatch(/IBAN su Stripe|\(Stripe Connect\)/);
    }
    expect(readFileSync('components/seller/SellerHealthScore.tsx', 'utf8')).toContain('prodottiPubblicati(productsTyped) >= 3');
    expect(ETICHETTA_PAGAMENTI).not.toMatch(/su Stripe/);
  });
});
