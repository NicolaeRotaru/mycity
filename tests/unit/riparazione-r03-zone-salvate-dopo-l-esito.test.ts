/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R03-008 — Le zone preferite del fattorino davano il salvataggio per fatto senza aspettare la
 * scrittura: la zona toccata restava scelta anche quando il database rifiutava, e un «salvate»
 * non c'era mai, né prima né dopo. Adesso: «Zone salvate» solo dopo l'esito riuscito; se la
 * scrittura cade, l'errore si vede e la zona non resta scelta come se fosse salvata.
 *
 * La pagina vera si monta con un Supabase finto in cui la scrittura risponde quando lo dice la prova.
 */

const mondo = vi.hoisted(() => ({
  avvisi: [] as Array<{ tipo: string; testo: string }>,
  scritte: [] as unknown[],
  rispondi: null as null | ((errore: { message: string } | null) => void),
}));

vi.mock('sonner', () => {
  const r = (tipo: string) => (testo: string) => { mondo.avvisi.push({ tipo, testo }); };
  return { toast: { success: r('success'), error: r('error'), info: r('info') } };
});
vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('@/lib/supabase/client', () => {
  const da = (_tabella: string) => {
    let aggiornamento: unknown = null;
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.update = (v: unknown) => { aggiornamento = v; return q; };
    q.eq = () => q;
    q.single = async () => ({ data: { rider_is_online: true, rider_schedule: null, rider_zones: [] }, error: null });
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      mondo.scritte.push(aggiornamento);
      return new Promise<{ data: null; error: { message: string } | null }>((fine) => {
        mondo.rispondi = (errore) => fine({ data: null, error: errore });
      }).then(ok, ko);
    };
    return q;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'luca' } }, error: null }) },
      from: da,
    },
  };
});

const { default: Disponibilita } = await import('@/app/rider/availability/page');

let radice: Root | null = null;
let div: HTMLDivElement | null = null;

const lascia = async () => {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

async function accendi() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
  await act(async () => { radice!.render(createElement(Disponibilita as never)); });
  await lascia();
  return div;
}

const zona = (d: HTMLElement, nome: string) =>
  [...d.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent?.includes(nome)) as HTMLButtonElement | undefined;

async function toccaStazione() {
  const d = await accendi();
  const stazione = zona(d, 'Stazione');
  expect(stazione, 'controprova: la zona «Stazione» si deve vedere').toBeTruthy();
  await act(async () => { stazione!.click(); });
  await lascia();
  expect(mondo.scritte, 'la scrittura delle zone non è partita').toEqual([{ rider_zones: ['Stazione'] }]);
  return d;
}

const successi = () => mondo.avvisi.filter((a) => a.tipo === 'success').map((a) => a.testo);

beforeEach(() => {
  mondo.avvisi = [];
  mondo.scritte = [];
  mondo.rispondi = null;
});

afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  radice = null;
});

describe('R03-008 — le zone dicono «salvate» solo dopo l’esito', () => {
  it('la scrittura cade: nessun «salvate», l’errore si vede e la zona non resta scelta', async () => {
    const d = await toccaStazione();
    expect(successi(), 'il successo compare prima dell’esito').toEqual([]);

    await act(async () => { mondo.rispondi!({ message: 'rete giù' }); });
    await lascia();
    expect(successi()).toEqual([]);
    expect(mondo.avvisi.some((a) => a.tipo === 'error'), 'la scrittura caduta non dice niente').toBe(true);
    expect(
      zona(d, 'Stazione')!.getAttribute('aria-pressed'),
      'la zona resta scelta come se fosse salvata',
    ).toBe('false');
  });

  it('la scrittura riesce: «salvate» compare dopo l’esito, non prima', async () => {
    const d = await toccaStazione();
    expect(successi(), 'il successo compare prima dell’esito').toEqual([]);

    await act(async () => { mondo.rispondi!(null); });
    await lascia();
    expect(successi().some((t) => /salvat/i.test(t)), 'dopo una scrittura riuscita nessun «salvate»').toBe(true);
    expect(mondo.avvisi.some((a) => a.tipo === 'error')).toBe(false);
    expect(zona(d, 'Stazione')!.getAttribute('aria-pressed')).toBe('true');
  });
});
