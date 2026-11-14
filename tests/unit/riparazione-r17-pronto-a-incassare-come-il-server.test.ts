import { describe, it, expect } from 'vitest';
import { pagamentiPronti } from '@/components/seller/pronto-a-incassare';

/** R17-009 — «pronto a incassare» dice quello che dice il server prima del bonifico (conto Stripe E versamenti accesi). */
const IBAN = 'IT60X0542811101000000123456';

describe('R17-009 — una regola sola', () => {
  it('carta accesa: incassi accesi ma versamenti no => NON pronto (il server ferma il bonifico)', () => {
    expect(pagamentiPronti({ stripe_account_id: 'acct_1', stripe_charges_enabled: true, stripe_payouts_enabled: false, billing_iban: null }, true)).toBe(false);
    expect(pagamentiPronti({ stripe_account_id: 'acct_1', stripe_charges_enabled: true, stripe_payouts_enabled: false, billing_iban: IBAN }, true)).toBe(false);
  });
  it('carta accesa: conto E versamenti => pronto; versamenti senza conto => no', () => {
    expect(pagamentiPronti({ stripe_account_id: 'acct_1', stripe_payouts_enabled: true }, true)).toBe(true);
    expect(pagamentiPronti({ stripe_account_id: null, stripe_payouts_enabled: true }, true)).toBe(false);
  });
  it('carta spenta: conta l\'IBAN (valido), non Stripe', () => {
    expect(pagamentiPronti({ stripe_account_id: 'acct_1', stripe_payouts_enabled: true, stripe_charges_enabled: true, billing_iban: null }, false)).toBe(false);
    expect(pagamentiPronti({ billing_iban: IBAN }, false)).toBe(true);
    expect(pagamentiPronti({ billing_iban: 'abc' }, false)).toBe(false);
  });
});
