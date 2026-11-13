// @vitest-environment jsdom
/**
 * R12-014 — Sul telefono piccolo la pagina del registro delle azioni scorreva
 * di lato (il menu del filtro senza larghezza massima), e l'elenco si fermava
 * a 200 righe senza dirlo: con 669 voci se ne vedeva un terzo.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna } from './aiuti/cabina-admin';

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));

const riga = (i: number) => ({
  id: String(i), actor_id: null, action: 'user.suspend', target_table: null, target_id: null,
  metadata: null, ip: null, created_at: '2026-11-01T10:00:00Z', actor: null,
});

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

async function apri(righe: number, totale: number) {
  fake.rispondi = () => ({ data: Array.from({ length: righe }, (_, i) => riga(i)), error: null, count: totale } as never);
  const mod = (await import('@/app/admin/audit/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('R12-014 il registro delle azioni dice quante ne mostra', () => {
  it('con 669 azioni ne mostra 200 e lo dice', async () => {
    const host = await apri(200, 669);
    expect(host.textContent).toMatch(/200 azioni più recenti di 669/);
  });

  it('quando le mostra tutte non dice niente', async () => {
    const host = await apri(12, 12);
    expect(host.textContent).not.toMatch(/più recenti di/);
  });

  it('il menu del filtro non supera la larghezza dello schermo', async () => {
    const host = await apri(1, 1);
    expect(host.querySelector('select')?.className).toMatch(/max-w-full/);
  });
});
