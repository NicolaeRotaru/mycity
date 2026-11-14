// @vitest-environment jsdom
/**
 * R24-012 — Nella pagina «Lascia una recensione» dell'ordine:
 *  ① un doppio clic su «Invia recensione» mandava due scritture: la seconda urtava il vincolo
 *    (order_id, user_id) e il cliente, alla sua PRIMA recensione, leggeva «Avevi già recensito»;
 *  ② le stelle non si muovevano con le frecce (solo Tab più Invio, stella per stella);
 *  ③ il commento non aveva né tetto né contatore.
 * Qui la pagina VERA, con un database finto che conta le scritture.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const stato = vi.hoisted(() => ({
  scritture: [] as string[],
  toast: [] as string[],
  // Quante scritture devono ancora fallire per un guasto (non un doppione).
  guasti: 0,
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('react', async (o) => ({ ...(await o<Record<string, unknown>>()), use: () => ({ id: 'o1' }) }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({
  toast: {
    success: (m: string) => stato.toast.push(`ok:${m}`),
    info: (m: string) => stato.toast.push(`info:${m}`),
    error: (m: string) => stato.toast.push(`err:${m}`),
  },
}));
vi.mock('@/lib/queries/negozio-dell-ordine', () => ({
  conNegozioDellOrdine: async (_s: unknown, r: unknown[]) => r.map((x) => ({ ...(x as object), seller: { store_name: 'Pane Quotidiano' } })),
  conFattorinoDellOrdine: async (_s: unknown, r: unknown[]) => r.map((x) => ({ ...(x as object), rider: null })),
}));
// Il database vero: la prima scritta entra, la seconda sullo stesso ordine urta il vincolo unico.
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'b1' } } }) },
    from: (t: string) =>
      t === 'orders'
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'o1', delivery_status: 'DELIVERED', seller_id: 's1', rider_id: null }, error: null }) }) }) }
        : {
            select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
            insert: async () => {
              if (stato.guasti > 0) {
                stato.guasti -= 1;
                return { error: { code: '08006', message: 'connessione interrotta' } };
              }
              stato.scritture.push(t);
              return { error: stato.scritture.filter((x) => x === t).length > 1 ? { code: '23505', message: 'duplicate key' } : null };
            },
          },
  },
}));

import OrderReviewPage from '@/app/orders/[id]/review/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let c: HTMLDivElement;
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function monta() {
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(OrderReviewPage, { params: Promise.resolve({ id: 'o1' }) }))),
  );
  for (let i = 0; i < 5; i++) await pausa();
}
const invia = () => Array.from(c.querySelectorAll('button')).find((b) => /Invia recensione/.test(b.textContent ?? '')) as HTMLButtonElement;
const stelle = () => Array.from(c.querySelectorAll('[role="group"][aria-label="Il tuo voto sul negozio"] button')) as HTMLButtonElement[];
const scelte = () => stelle().filter((b) => b.getAttribute('aria-pressed') === 'true').length;
const freccia = (el: Element, key: string) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

beforeEach(() => {
  stato.scritture = [];
  stato.toast = [];
  stato.guasti = 0;
  router.push.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
});

describe('R24-012 · la recensione col doppio clic parte una volta', () => {
  it('due clic nello stesso istante: una scrittura sola e nessun «Avevi già recensito»', async () => {
    await monta();
    await act(async () => { (c.querySelector('button[aria-label="4 stelle"]') as HTMLButtonElement).click(); });
    await act(async () => {
      invia().click();
      invia().click();
    });
    for (let i = 0; i < 4; i++) await pausa();
    expect(stato.scritture, 'il secondo clic ha mandato una seconda recensione').toEqual(['store_reviews']);
    expect(stato.toast.join(' '), 'alla prima recensione il cliente legge «Avevi già recensito»').not.toContain('Avevi già recensito');
    expect(stato.toast.join(' ')).toContain('Grazie per la recensione');
  });

  it('un clic, la risposta, un secondo clic prima che la pagina cambi: sempre una scrittura sola', async () => {
    await monta();
    await act(async () => { (c.querySelector('button[aria-label="4 stelle"]') as HTMLButtonElement).click(); });
    await act(async () => { invia().click(); });
    for (let i = 0; i < 4; i++) await pausa();
    expect(stato.toast.join(' '), 'il primo invio non è arrivato in fondo: la prova non guarda niente').toContain('Grazie per la recensione');
    expect(router.push).toHaveBeenCalledTimes(1);
    // router.push è partito ma la pagina c'è ancora: il secondo clic arriva qui.
    await act(async () => { invia().click(); });
    for (let i = 0; i < 4; i++) await pausa();
    expect(stato.scritture, 'dopo l’invio riuscito il freno si è riaperto').toEqual(['store_reviews']);
    expect(stato.toast.join(' ')).not.toContain('Avevi già recensito');
  });

  it('dopo l’invio riuscito, con la pagina ancora lì, il pulsante è spento e non sembra attivo', async () => {
    await monta();
    await act(async () => { (c.querySelector('button[aria-label="4 stelle"]') as HTMLButtonElement).click(); });
    await act(async () => { invia().click(); });
    for (let i = 0; i < 4; i++) await pausa();
    expect(stato.toast.join(' ')).toContain('Grazie per la recensione');
    expect(invia().disabled, 'dopo il successo il pulsante sembra attivo ma ingoia il clic').toBe(true);
    expect(invia().getAttribute('aria-busy')).toBe('true');
  });

  it('se l’invio non riesce il freno si riapre e si può riprovare', async () => {
    await monta();
    stato.guasti = 1;
    await act(async () => { (c.querySelector('button[aria-label="4 stelle"]') as HTMLButtonElement).click(); });
    await act(async () => { invia().click(); });
    for (let i = 0; i < 4; i++) await pausa();
    expect(stato.toast.some((m) => m.startsWith('err:'))).toBe(true);
    await act(async () => { invia().click(); });
    for (let i = 0; i < 4; i++) await pausa();
    expect(stato.scritture, 'dopo un errore il secondo tentativo non parte').toEqual(['store_reviews']);
    expect(stato.toast.join(' ')).toContain('Grazie per la recensione');
  });
});

describe('R24-012 · le stelle si scelgono anche con le frecce', () => {
  it('nel giro del Tab entra una stella sola, e tre frecce a destra danno 4 stelle col fuoco sulla quarta', async () => {
    await monta();
    expect(stelle().filter((b) => b.tabIndex === 0).length, 'col Tab si passa su tutte e cinque le stelle').toBe(1);
    const prima = stelle()[0];
    expect(prima.tabIndex).toBe(0);
    prima.focus();
    for (let i = 0; i < 3; i++) await act(async () => { freccia(document.activeElement!, 'ArrowRight'); });
    expect(scelte(), 'le frecce non cambiano il voto').toBe(4);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('4 stelle');
    expect(stelle().filter((b) => b.tabIndex === 0).map((b) => b.getAttribute('aria-label'))).toEqual(['4 stelle']);
    await act(async () => { freccia(document.activeElement!, 'ArrowLeft'); });
    expect(scelte()).toBe(3);
    await act(async () => { freccia(document.activeElement!, 'End'); });
    expect(scelte()).toBe(5);
    await act(async () => { freccia(document.activeElement!, 'Home'); });
    expect(scelte()).toBe(1);
  });
});

describe('R24-012 · il commento ha un tetto e lo dice', () => {
  it('il campo si ferma a 1000 caratteri e conta quelli scritti', async () => {
    await monta();
    const campo = c.querySelector('textarea') as HTMLTextAreaElement;
    expect(campo.maxLength, 'il commento accetta qualunque lunghezza').toBe(1000);
    expect(c.textContent).toContain('0/1000');
  });
});
