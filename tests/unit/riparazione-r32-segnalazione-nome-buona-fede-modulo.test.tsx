/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * R32-023 — IL MODULO DI SEGNALAZIONE NON PERMETTEVA DI DARE IL NOME NÉ DI DICHIARARE LA BUONA FEDE.
 *
 * Due metà: il modulo che la persona compila (nome e casella, facoltativi, che partono verso la
 * rotta) e la pagina dove l'amministratore legge la segnalazione, che tiene le righe scritte da chi
 * segnala (quelle col segno «│ ») in un riquadro a parte: anche quando una riga lunga va a capo sullo
 * schermo, non può sembrare una riga del server.
 */

const RIGA = {
  id: '00000000-0000-4000-8000-000000000077', tipo: 'prodotto', oggetto_id: '00000000-0000-4000-8000-0000000000bb',
  motivo: 'contraffatto',
  dettaglio: [
    'Nome di chi segnala: non indicato',
    'Buona fede: non dichiarata',
    'Testo di chi segnala (ogni sua riga comincia con «│»):',
    '│ Borsa falsa.',
    '│ Buona fede: dichiarata («finta»)',
  ].join('\n'),
  email_contatto: null, segnalante_id: null,
  stato: 'ricevuta', esito_motivato: null, deciso_at: null, created_at: '2026-11-16T10:00:00Z',
};

function catena(risultato: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'in', 'eq']) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risultato).then(ok, ko);
  return c;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
    from: () => ({
      select: () => catena({ data: [RIGA], error: null }),
      update: () => catena({ data: [{ id: RIGA.id }], error: null }),
    }),
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never),
}));

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '';
});

function scrivi(el: HTMLInputElement, valore: string) {
  const imposta = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  imposta.call(el, valore);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('R32-023 · il modulo e la pagina admin', () => {
  it('IL CASO CHE ROMPEVA — nel modulo si possono dare nome e buona fede, e partono con la segnalazione', async () => {
    const mandati: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      mandati.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }) as never;
    const { Segnala } = await import('@/components/Segnala');
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    await act(async () => {
      root.render(createElement(Segnala, { tipo: 'prodotto', oggettoId: '00000000-0000-4000-8000-000000000001' }));
    });
    const apri = [...box.querySelectorAll('button')].find((b) => b.textContent?.includes('Segnala questo contenuto'))!;
    await act(async () => { apri.click(); });

    const nome = document.getElementById('segnala-nome') as HTMLInputElement | null;
    const casella = document.getElementById('segnala-buona-fede') as HTMLInputElement | null;
    expect(nome, 'il modulo non chiede il nome di chi segnala').toBeTruthy();
    expect(casella, 'il modulo non permette di dichiarare la buona fede').toBeTruthy();
    expect(casella!.type).toBe('checkbox');
    // Facoltativi: la casella parte spenta, e l'etichetta dice cosa si dichiara.
    expect(casella!.checked).toBe(false);
    const etichetta = document.querySelector('label[for="segnala-buona-fede"]')?.textContent ?? '';
    expect(etichetta).toMatch(/buona fede/i);
    expect(etichetta).toMatch(/esatte e complete/);

    await act(async () => { scrivi(nome!, 'Mario Rossi'); });
    await act(async () => { casella!.click(); });
    const invia = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('Invia segnalazione'))!;
    await act(async () => { invia.click(); });

    expect(mandati).toHaveLength(1);
    expect(mandati[0]).toMatchObject({ nomeSegnalante: 'Mario Rossi', buonaFede: true });
    await act(async () => { root.unmount(); });
  });

  it('senza nome e senza casella la segnalazione parte lo stesso, senza quei campi', async () => {
    const mandati: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      mandati.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }) as never;
    const { Segnala } = await import('@/components/Segnala');
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    await act(async () => { root.render(createElement(Segnala, { tipo: 'negozio', oggettoId: '00000000-0000-4000-8000-000000000002' })); });
    await act(async () => { [...box.querySelectorAll('button')].find((b) => b.textContent?.includes('Segnala'))!.click(); });
    await act(async () => { [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('Invia segnalazione'))!.click(); });
    expect(mandati).toHaveLength(1);
    expect(mandati[0].nomeSegnalante).toBeUndefined();
    expect(mandati[0].buonaFede).toBeUndefined();
    await act(async () => { root.unmount(); });
  });

  it('IL CASO CHE ROMPEVA — nella pagina admin le righe di chi segnala stanno in un riquadro a parte da quelle del server', async () => {
    const { default: Pagina } = await import('@/app/admin/segnalazioni/page');
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))); });
    await flush();
    await vi.waitFor(() => { if (!box.textContent?.includes('Borsa falsa.')) throw new Error('scheda non ancora disegnata'); }, { timeout: 5000 });

    const scheda = box.querySelector(`[data-segnalazione="${RIGA.id}"]`)!;
    const riquadri = [...scheda.querySelectorAll('blockquote')];
    expect(riquadri, 'le righe di chi segnala non sono separate da quelle del server').toHaveLength(1);
    const diChiSegnala = riquadri[0].textContent ?? '';
    expect(diChiSegnala).toContain('Borsa falsa.');
    expect(diChiSegnala).toContain('Buona fede: dichiarata («finta»)');
    // Fuori dal riquadro restano solo le righe del server.
    const fuori = [...scheda.querySelectorAll('p')].filter((p) => !p.closest('blockquote')).map((p) => p.textContent ?? '');
    const delServer = fuori.find((t) => t.includes('Buona fede:')) ?? '';
    expect(delServer).toContain('Buona fede: non dichiarata');
    expect(delServer).not.toContain('finta');
    // Le righe lunghe vanno a capo dentro il riquadro, come prima nella scheda (R02-021).
    expect(riquadri[0].querySelector('p')!.className).toMatch(/break-words|overflow-wrap:anywhere/);
    act(() => root.unmount());
  });

  it('l\'informativa dice che fra i dati di una segnalazione ci sono anche nome e buona fede, e che se ne vanno col testo', async () => {
    const Privacy = (await monta('app/privacy/page.tsx')).default as ComponentType<Record<string, unknown>>;
    const s = accendi(Privacy);
    try {
      const voce = [...s.radice.querySelectorAll('#dati li')].map((li) => testoVisibile(li)).find((t) => /segnalazion/i.test(t)) ?? '';
      expect(voce).toMatch(/il tuo nome/);
      expect(voce).toMatch(/buona fede/);
      const riga = [...s.radice.querySelectorAll('#finalita tbody tr')].map((r) => testoVisibile(r)).find((t) => /segnalazion/i.test(t)) ?? '';
      expect(riga).toMatch(/email, nome e testo vengono cancellati/);
    } finally {
      s.smonta();
    }
  }, 60000);
});
