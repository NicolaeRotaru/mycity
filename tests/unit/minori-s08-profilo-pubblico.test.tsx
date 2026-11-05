/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { accendi } from './aiuti/schermo';
import { testoVisibile } from './aiuti/monta-componente';

/** S08 (5/11/2026) — Il profilo pubblico /u/<handle> e il suo interruttore. */

const stato: {
  profilo: { data: unknown; error: { message: string } | null };
  badge: unknown[];
  ilike: string[];
  log: string[];
  lettura: { data: unknown; error: { message: string } | null };
  scritture: unknown[];
  appunti: 'ok' | 'ko';
  toast: Array<{ tipo: string; testo: string }>;
} = {
  profilo: { data: null, error: null }, badge: [], ilike: [], log: [],
  lettura: { data: null, error: null }, scritture: [], appunti: 'ok', toast: [],
};

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q;
      q.ilike = (_c: string, v: string) => { stato.ilike.push(v); return q; };
      q.maybeSingle = async () => stato.profilo;
      q.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve(tabella === 'user_achievements' ? { data: stato.badge, error: null } : { data: [], error: null }).then(ok);
      return q;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: (m: string) => { stato.log.push(m); }, warn: () => {}, info: () => {}, spesa: () => {} },
}));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children }: { href: unknown; children?: unknown }) => ce('a', { href: String(href) }, children as never) };
});
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => stato.lettura }) }),
      update: (v: unknown) => { stato.scritture.push(v); return { eq: async () => ({ error: null }) }; },
    }),
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => {
  const r = (tipo: string) => (testo: string) => { stato.toast.push({ tipo, testo }); };
  return { toast: { success: r('success'), error: r('error') } };
});

import PublicProfilePage from '@/app/u/[handle]/page';
import { handleEsatto } from '@/app/u/[handle]/handle';
import PublicProfileToggle from '@/components/PublicProfileToggle';

const MARIA = { id: 'u-9', public_handle: 'maria_pc', public_bio: 'Ciao', public_avatar_url: null, full_name: 'Maria Rossi' };
const apri = (handle: string) => PublicProfilePage({ params: Promise.resolve({ handle }) });

beforeEach(() => {
  stato.profilo = { data: MARIA, error: null };
  stato.badge = [];
  stato.ilike = [];
  stato.log = [];
  stato.lettura = { data: { public_profile_enabled: true, public_handle: 'maria_pc', public_bio: 'Ciao' }, error: null };
  stato.scritture = [];
  stato.appunti = 'ok';
  stato.toast = [];
});

describe('la pagina pubblica', () => {
  it('scheda 1739 — «_» e «%» non valgono come jolly nella ricerca dell handle', async () => {
    expect(handleEsatto('a_b%')).toBe('a\\_b\\%');
    await apri('maria_pc');
    expect(stato.ilike).toEqual(['maria\\_pc']);
  });

  it('scheda 1739 — un handle con «*» o altri caratteri non arriva al database: «non trovato», non un errore', async () => {
    await expect(apri('*')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(apri('a%')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(stato.ilike).toEqual([]);
  });

  it('scheda 1723 — un guasto della lettura non diventa «non trovato», e si scrive nei registri', async () => {
    stato.profilo = { data: null, error: { message: 'più righe' } };
    await expect(apri('maria_pc')).rejects.not.toThrow('NEXT_NOT_FOUND');
    expect(stato.log.length).toBeGreaterThan(0);
  });

  it('scheda 1723 — «non trovato» resta solo quando la lettura riesce e non c è nessuno', async () => {
    stato.profilo = { data: null, error: null };
    await expect(apri('nessuno')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('schede 1737 e 1720 — i badge si vedono, e la scritta non dice «Buyer»', async () => {
    stato.badge = [
      { achievement_id: 'a', unlocked_at: '2026-10-01', achievement: { title: 'Primo ordine', icon: null, tier: 'bronzo' } },
      { achievement_id: 'b', unlocked_at: '2026-10-02', achievement: { title: 'Cliente fedele', icon: null, tier: 'argento' } },
    ];
    const html = renderToStaticMarkup((await apri('maria_pc')) as never);
    expect(html.replace(/<!-- -->/g, "")).toContain("Achievement sbloccati (2)");
    expect(html).toContain('Primo ordine');
    expect(html).not.toContain('Buyer');
  });
});

async function aspetta() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('l interruttore del profilo pubblico', () => {
  it('scheda 1738 — dice che si vedono anche nome e cognome', async () => {
    const s = accendi(PublicProfileToggle);
    await aspetta();
    expect(testoVisibile(s.radice)).toMatch(/nome e cognome/);
    s.smonta();
  });

  it('scheda 329 — se la lettura cade non si vede spento coi campi vuoti, e Salva non azzera niente', async () => {
    stato.lettura = { data: null, error: { message: 'rete giù' } };
    const s = accendi(PublicProfileToggle);
    await aspetta();
    expect(testoVisibile(s.radice)).toContain('Non riusciamo a leggere il tuo profilo pubblico');
    const salva = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).includes('save'));
    expect(salva, 'il pulsante Salva non deve esserci finché il profilo non è letto').toBeUndefined();
    expect(stato.scritture).toHaveLength(0);
    s.smonta();
  });

  it('scheda 329 — «copiato» solo se gli appunti hanno davvero copiato', async () => {
    stato.appunti = 'ko';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { if (stato.appunti === 'ko') throw new Error('negato'); } },
    });
    const s = accendi(PublicProfileToggle);
    await aspetta();
    const copia = s.radice.querySelector('button[aria-label^="Copia"]')!;
    s.agisci(() => { copia.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    await aspetta();
    expect(stato.toast.map((t) => t.tipo)).not.toContain('success');
    expect(stato.toast.map((t) => t.tipo)).toContain('error');
    s.smonta();
  });
});

void createElement;
