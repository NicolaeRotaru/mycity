import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S10 (5/11/2026, scheda 368) — la barra in basso non porta nel pacchetto di
 * ogni pagina il codice dell'assistenza: lo scarica solo quando la si apre.
 */
describe('l\'assistenza si scarica solo quando serve (368)', () => {
  it('niente import statico di SupportChatModal, e si monta solo se aperta', () => {
    const src = readFileSync('components/MobileTabBar.tsx', 'utf8');
    expect(src).not.toMatch(/^import SupportChatModal from/m);
    expect(src).toMatch(/dynamic\(\(\) => import\('\.\/SupportChatModal'\), \{ ssr: false \}\)/);
    expect(src).toMatch(/\{isBuyer && supportOpen && \(/);
  });
});

describe('dopo l\'accesso «Negozi» resta al suo posto (1024)', () => {
  it('ospite e cliente hanno le stesse quattro porte prima dell\'account', async () => {
    const { schedeInFondo } = await import('@/lib/ui/schede-in-fondo');
    const t = (k: string) => k;
    const base = { isSeller: false, isRider: false, isAdmin: false, sellerShopping: false };
    const ospite = schedeInFondo({ ...base, isAuthenticated: false } as never, t).map((s) => s.href);
    const cliente = schedeInFondo({ ...base, isAuthenticated: true } as never, t).map((s) => s.href);
    expect(cliente.slice(0, 4)).toEqual(ospite.slice(0, 4));
    expect(cliente).toContain('/stores');
    expect(cliente[4]).toBe('/profile');
  });
  it('«I miei ordini» resta raggiungibile dal foglio «Io»', () => {
    expect(readFileSync('lib/account-menu.ts', 'utf8')).toMatch(/href: '\/orders'/);
  });
});
