import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R03-003 — Il sottotitolo della variante «a» della home diceva «Consegna in giornata, nella fascia
 * oraria che scegli, a negozio aperto.»: si leggeva come «consegna solo a negozio aperto», mentre la
 * merce si ritira a negozio aperto e arriva nella fascia scelta anche dopo la chiusura
 * (lib/promesse-pubbliche.ts). Ora la frase è solo quella di lib/promesse-pubbliche.ts.
 *
 * Qui la home VERA, con l'esperimento sulla variante «a»: si legge il sottotitolo che arriva all'hero.
 */

vi.mock('next/headers', () => ({ headers: async () => ({ get: () => 'a' }) }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }));
vi.mock('@/lib/queries/precarico', () => ({ precaricaHome: async () => ({ mutations: [], queries: [] }) }));
vi.mock('@/lib/supabase/anonimo', () => {
  const catena: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq']) catena[m] = () => catena;
  catena.maybeSingle = async () => ({ data: null, error: null });
  return { creaClientAnonimo: () => catena };
});
vi.mock('@tanstack/react-query', () => ({ HydrationBoundary: ({ children }: { children: unknown }) => children }));
vi.mock('@/components/home/ExperimentExposure', () => ({ default: () => null }));
// L'hero riceve i suoi testi di partenza dalla pagina: qui si disegna solo il sottotitolo.
vi.mock('@/components/home-sections/HomeSectionRenderer', () => ({
  default: ({ heroDefaults, heroVariant }: { heroDefaults: { subhead: unknown }; heroVariant: string }) =>
    createElement('p', { id: 'sottotitolo', 'data-variante': heroVariant }, heroDefaults.subhead as never),
}));

import Home from '@/app/page';
import { QUANDO_ARRIVA_SENZA_NEGOZIO } from '@/lib/promesse-pubbliche';

const testo = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

describe('R03-003 · la variante «a» della home non lega la consegna al negozio aperto', () => {
  it('il sottotitolo dice la frase delle promesse pubbliche, senza «a negozio aperto»', async () => {
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('data-variante="a"');
    const sottotitolo = testo(html.match(/<p id="sottotitolo"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '');
    expect(sottotitolo).toContain('puoi pagare alla consegna');
    expect(sottotitolo, 'la consegna non arriva solo a negozio aperto').not.toMatch(/negozio aperto/i);
    expect(sottotitolo).toContain(`Consegna ${QUANDO_ARRIVA_SENZA_NEGOZIO}.`);
  });
});
