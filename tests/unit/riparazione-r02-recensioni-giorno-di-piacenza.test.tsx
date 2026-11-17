/**
 * @vitest-environment jsdom
 */
/**
 * R02-010 (onda 9) — NELLA VETRINA DEL NEGOZIO LA DATA DELLE RECENSIONI È QUELLA DI PIACENZA.
 *
 * `ReviewsSection` scriveva `toLocaleDateString('it-IT')` senza fuso: il giorno lo decideva il
 * telefono di chi legge. Una recensione lasciata a Piacenza alle 0:30 del 17 novembre (le 23:30 del
 * 16 in UTC), letta da un telefono a New York, risultava del 16. Qui la prova gira apposta con il
 * fuso di New York: senza la correzione la data esce un giorno prima.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/components/Segnala', () => ({ Segnala: () => null }));
vi.mock('@/components/hooks/useUtente', () => ({ useUtente: () => ({ userId: null }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'in', 'eq']) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
  return { supabase: c };
});

import ReviewsSection from '@/components/store-sections/ReviewsSection';

const fusoDiPrima = process.env.TZ;
afterEach(() => {
  if (fusoDiPrima === undefined) delete process.env.TZ;
  else process.env.TZ = fusoDiPrima;
});

describe('R02-010 · la data delle recensioni nel fuso di Piacenza', () => {
  it('una recensione delle 0:30 di Piacenza, letta da un telefono a New York, è del giorno di Piacenza', async () => {
    process.env.TZ = 'America/New_York';
    const istante = '2026-11-16T23:30:00Z'; // a Piacenza: martedì 17/11/2026 alle 0:30
    expect(new Date(istante).getDate(), 'controprova: la prova gira davvero in un fuso dove è ancora il 16').toBe(16);

    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    const recensione = {
      id: 'rv-1', rating: 5, comment: 'Pane ancora caldo', created_at: istante, seller_reply: null,
      user_id: null, order_id: null, photo_urls: null, helpful_count: 0, author: null,
    };
    const ctx = { reviews: [recensione], accent: '#7A8B3C', recensioniInErrore: false, riepilogoRecensioni: null };
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ReviewsSection, { ctx: ctx as never })));
    });
    const testo = box.textContent ?? '';
    expect(testo, 'controprova: la recensione è disegnata').toContain('Pane ancora caldo');
    expect(testo, 'la data è quella del telefono (16/11), non quella di Piacenza').toContain('17/11/2026');
    expect(testo).not.toContain('16/11/2026');
    act(() => root.unmount());
  });
});
