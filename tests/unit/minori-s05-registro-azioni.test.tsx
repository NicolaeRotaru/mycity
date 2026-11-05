// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna } from './aiuti/cabina-admin';
import { autoreDellaRiga } from '@/lib/admin/etichette';

/**
 * S05 · scheda 1814 — un'azione fatta da una persona senza nome nel profilo, o
 * da un account poi cancellato, compariva «da sistema». Ogni riga ha un autore umano.
 */

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

describe('registro delle azioni: chi l’ha fatta', () => {
  it('autore con id ma senza nome → non «sistema»', async () => {
    fake.rispondi = () => ({
      data: [{ id: '1', actor_id: 'abcdef12-0000-4000-8000-000000000000', action: 'user.suspend', target_table: null,
        target_id: null, metadata: null, ip: null, created_at: '2026-11-01T10:00:00Z', actor: { full_name: null } }],
      error: null,
    });
    const mod = (await import('@/app/admin/audit/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    expect(r.host.textContent).not.toContain('da sistema');
    expect(r.host.textContent).toContain('utente senza nome (abcdef12…)');
  });

  // 5/11/2026 (unione, collaudo della 1814) — Senza autore può essere un account cancellato OPPURE un
  // lavoro automatico (lib/privacy/avvisi-a-chi-aspetta.ts, lib/account/cancellazione.ts scrivono
  // actor_id null apposta): la pagina li nomina tutti e due.
  it('senza autore (actor_id null) → «sistema o account cancellato»', () => {
    expect(autoreDellaRiga({ actor_id: null, actor: null })).toBe('sistema o account cancellato');
    expect(autoreDellaRiga({ actor_id: 'x', actor: { full_name: 'Nicola' } })).toBe('Nicola');
  });
});
