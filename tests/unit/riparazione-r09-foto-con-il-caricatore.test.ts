/**
 * R09-007 — Carrello condiviso, prodotti del negozio e dettaglio ordine: le miniature dei prodotti
 * non sono più `unoptimized` (che spegne srcset e sizes e lascia la foto sgranata sui telefoni a
 * densità 2-3) ma passano dal caricatore `caricatoreFotoRemote`, che chiede la larghezza giusta.
 * Il logo del negozio nel dettaglio ordine resta com'è (il caricatore lo ritaglierebbe a quadrato).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const leggi = (f: string) => readFileSync(join(process.cwd(), ...f.split('/')), 'utf8');

describe('R09-007 foto dei prodotti col caricatore, non unoptimized', () => {
  it('shared-cart: la miniatura usa il caricatore', () => {
    const s = leggi('app/shared-cart/page.tsx');
    expect(s).not.toMatch(/\bunoptimized\b/);
    expect(s).toMatch(/loader=\{caricatoreFotoRemote\}/);
  });
  it('seller/products: le due miniature (tabella e schede) usano il caricatore', () => {
    const s = leggi('app/seller/products/page.tsx');
    expect(s).not.toMatch(/\bunoptimized\b/);
    expect(s.match(/loader=\{caricatoreFotoRemote\}/g)?.length).toBe(2);
  });
  it('orders/[id]: la miniatura della riga usa il caricatore, solo il logo resta unoptimized', () => {
    const s = leggi('app/orders/[id]/page.tsx');
    expect(s).toMatch(/width=\{44\} height=\{44\} loader=\{caricatoreFotoRemote\}/);
    expect(s.match(/\bunoptimized\b/g)?.length).toBe(1);
    expect(s).toMatch(/logoNegozio\([^)]*\)[^\n]*unoptimized/);
  });
});
