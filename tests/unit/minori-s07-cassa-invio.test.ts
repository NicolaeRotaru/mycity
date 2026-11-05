import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('app/checkout/page.tsx', 'utf8');

describe('S07 · l’invio della cassa', () => {
  it('il credito si manda solo se la cassa l’ha letto (saldo sopra zero)', () => {
    expect(src).toMatch(/useCredit: useCredit && \(walletCents \?\? 0\) > 0,/);
  });
  it('chi entra dalla cassa e torna non riceve il «nessuno» salvato da ospite', () => {
    const q = src.slice(src.indexOf('queryKey: queryKeys.checkout.authUser'), src.indexOf('queryKey: queryKeys.checkout.authUser') + 600);
    expect(q).toMatch(/staleTime: 0,/);
    expect(q).toMatch(/refetchOnMount: 'always'/);
  });
});
