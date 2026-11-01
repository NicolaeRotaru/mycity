// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * IL MODULO «SEGNALA» NON PROMETTE UN ESITO CHE NON PARTE.
 *
 * 1/11/2026 — Il modulo diceva «ti scriviamo com'è finita e perché» e, dopo
 * l'invio, «ti diciamo com'è andata». Nessun codice mandava l'esito: la pagina
 * admin lo registra e basta. Una promessa al cliente che il sito non mantiene
 * è peggio di nessuna promessa (e il regolamento sui servizi digitali chiede
 * l'esito vero, non l'annuncio). Questa prova apre il modulo, lo invia, e
 * guarda cosa legge chi ha segnalato.
 */
const successi: string[] = [];
vi.mock('sonner', () => ({
  toast: { success: (m: string) => successi.push(m), error: vi.fn() },
}));

const PROMESSA = /ti diciamo|ti scriviamo|com'è andata|com'è finita/i;

describe('il modulo Segnala', () => {
  beforeEach(() => {
    successi.length = 0;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 })) as never;
  });

  it('dopo l invio conferma la ricezione senza promettere una risposta che non parte', async () => {
    const { Segnala } = await import('@/components/Segnala');
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    await act(async () => {
      root.render(createElement(Segnala, { tipo: 'prodotto', oggettoId: '00000000-0000-4000-8000-000000000001' }));
    });
    const apri = [...box.querySelectorAll('button')].find((b) => b.textContent?.includes('Segnala questo contenuto'));
    expect(apri).toBeTruthy();
    await act(async () => { apri!.click(); });

    expect(box.textContent ?? '').not.toMatch(PROMESSA);

    const invia = [...box.querySelectorAll('button')].find((b) => b.textContent?.includes('Invia segnalazione'));
    expect(invia).toBeTruthy();
    await act(async () => { invia!.click(); });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(successi).toHaveLength(1);
    expect(successi[0]).not.toMatch(PROMESSA);
    await act(async () => { root.unmount(); });
  });
});
