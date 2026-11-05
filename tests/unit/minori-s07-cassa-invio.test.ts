import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chiaveTentativo } from '@/lib/ordini/tentativo';

const src = readFileSync('app/checkout/page.tsx', 'utf8');

describe('S07 · l’invio della cassa', () => {
  it('l’impronta del tentativo contiene fascia, ritiro e indirizzo', () => {
    const impronta = src.slice(src.indexOf('const improntaCarrello = ['), src.indexOf("].join('|');") + 12);
    expect(impronta).toMatch(/`fascia=\$\{deliverySlot \?\? ''\}`/);
    expect(impronta).toMatch(/`ritiro=\$\{pickupInStore \? 1 : 0\}`/);
    expect(impronta).toMatch(/form\.address, form\.zip, form\.city/);
  });
  it('con un’impronta diversa (fascia cambiata) la chiave del tentativo è nuova', () => {
    const memoria = new Map<string, string>();
    const archivio = {
      getItem: (k: string) => memoria.get(k) ?? null,
      setItem: (k: string, v: string) => void memoria.set(k, v),
      removeItem: (k: string) => void memoria.delete(k),
    } as unknown as Storage;
    let n = 0;
    const nuova = () => `id-${++n}`;
    const a = chiaveTentativo(archivio, nuova, undefined, 'pane=1|fascia=Oggi · 9:00–11:00');
    const b = chiaveTentativo(archivio, nuova, undefined, 'pane=1|fascia=Oggi · 9:00–11:00');
    const c = chiaveTentativo(archivio, nuova, undefined, 'pane=1|fascia=Domani · 9:00–11:00');
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
  it('il credito si manda solo se la cassa l’ha letto (saldo sopra zero)', () => {
    expect(src).toMatch(/useCredit: useCredit && \(walletCents \?\? 0\) > 0,/);
  });
  it('chi entra dalla cassa e torna non riceve il «nessuno» salvato da ospite', () => {
    const q = src.slice(src.indexOf('queryKey: queryKeys.checkout.authUser'), src.indexOf('queryKey: queryKeys.checkout.authUser') + 600);
    expect(q).toMatch(/staleTime: 0,/);
    expect(q).toMatch(/refetchOnMount: 'always'/);
  });
});
