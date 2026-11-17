/**
 * @vitest-environment jsdom
 *
 * Le zone del fattorino davano il salvataggio per fatto prima dell'esito. La cura dice «Zone
 * salvate» solo dopo una scrittura riuscita, torna all'ultimo elenco confermato se cade, e scrive
 * in fila (due scritture in parallelo potevano arrivare al contrario e lasciare nel database
 * l'elenco vecchio). La fila ha un tempo massimo: una scrittura che non risponde non blocca i
 * tocchi dopo, che partono e si salvano. Se la scrittura appesa arriva tardi e rimette l'elenco
 * vecchio, si riscrive quello confermato.
 *
 * La pagina vera si monta con un Supabase finto in cui ogni scrittura risponde quando lo dice la
 * prova (o mai); l'orologio è finto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type Rispondi = (errore: { message: string } | null) => void;
type Scrittura = { zone: string[]; rispondi: Rispondi };
const mondo = vi.hoisted(() => ({
  avvisi: [] as Array<{ tipo: string; testo: string }>,
  /** Le scritture delle zone partite, nell'ordine di partenza. */
  scritture: [] as Scrittura[],
  /** Le zone nel finto database: cambiano quando una scrittura riesce, nell'ordine in cui arrivano. */
  db: [] as string[],
}));

vi.mock('sonner', () => {
  const r = (tipo: string) => (testo: string) => { mondo.avvisi.push({ tipo, testo }); };
  return { toast: { success: r('success'), error: r('error'), info: r('info') } };
});
vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('@/lib/supabase/client', () => {
  const da = () => {
    let aggiornamento: { rider_zones?: string[] } | null = null;
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.update = (v: { rider_zones?: string[] }) => { aggiornamento = v; return q; };
    q.eq = () => q;
    q.single = async () => ({ data: { rider_is_online: true, rider_schedule: null, rider_zones: [] }, error: null });
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      const zone = aggiornamento?.rider_zones ?? [];
      return new Promise<{ data: null; error: { message: string } | null }>((fine) => {
        mondo.scritture.push({
          zone,
          rispondi: (errore) => {
            if (!errore) mondo.db = zone;
            fine({ data: null, error: errore });
          },
        });
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

/** Lascia correre l'orologio finto (e le promesse in mezzo) per `ms` millisecondi. */
const passa = async (ms = 1) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

async function accendi() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
  await act(async () => { radice!.render(createElement(Disponibilita as never)); });
  for (let i = 0; i < 5; i++) await passa();
  return div;
}

const zona = (d: HTMLElement, nome: string) =>
  [...d.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent?.includes(nome)) as HTMLButtonElement;
const tocca = async (d: HTMLElement, nome: string) => {
  expect(zona(d, nome), `controprova: la zona «${nome}» si deve vedere`).toBeTruthy();
  await act(async () => { zona(d, nome).click(); });
  await passa();
};
const scelte = (d: HTMLElement) =>
  [...d.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent?.trim() ?? '');
const successi = () => mondo.avvisi.filter((a) => a.tipo === 'success').map((a) => a.testo);
const errori = () => mondo.avvisi.filter((a) => a.tipo === 'error').map((a) => a.testo);
const risponde = async (n: number, errore: { message: string } | null = null) => {
  await act(async () => { mondo.scritture[n].rispondi(errore); });
  await passa();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T09:00:00Z'));
  mondo.avvisi = [];
  mondo.scritture = [];
  mondo.db = [];
});

afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  radice = null;
  vi.useRealTimers();
});

describe('le zone dicono «salvate» solo dopo l’esito', () => {
  it('esito riuscito: «Zone salvate» compare dopo la risposta, non prima', async () => {
    const d = await accendi();
    await tocca(d, 'Stazione');
    expect(mondo.scritture.map((s) => s.zone)).toEqual([['Stazione']]);
    expect(successi(), '«salvate» prima dell’esito').toEqual([]);

    await risponde(0);
    expect(successi()).toEqual(['Zone salvate']);
    expect(scelte(d)).toEqual(['Stazione']);
    expect(mondo.db).toEqual(['Stazione']);
  });

  it('esito caduto: niente «salvate», l’errore si vede e lo schermo torna all’ultimo elenco confermato', async () => {
    const d = await accendi();
    await tocca(d, 'Stazione');
    await risponde(0);
    await tocca(d, 'Roma');
    expect(scelte(d)).toEqual(['Stazione', 'Roma']);

    await risponde(1, { message: 'rete giù' });
    expect(successi(), 'un solo «salvate», quello della prima scrittura').toEqual(['Zone salvate']);
    expect(errori().length, 'la scrittura caduta non dice niente').toBeGreaterThan(0);
    expect(scelte(d), 'la zona non salvata resta scelta').toEqual(['Stazione']);
  });
});

describe('una scrittura che non risponde non blocca i tocchi dopo', () => {
  it('scrittura appesa, poi un tocco nuovo: dopo il tempo massimo il tocco nuovo parte e si salva, un solo «salvate»', async () => {
    const d = await accendi();
    await tocca(d, 'Stazione'); // questa scrittura non risponderà mai
    await passa(2_000);
    await tocca(d, 'Roma');
    expect(mondo.scritture.length, 'le scritture vanno in fila: il tocco nuovo aspetta la risposta della prima, o il tempo massimo').toBe(1);

    await passa(10_000);
    expect(mondo.scritture.map((s) => s.zone), 'la scrittura appesa tiene ferma la fila per sempre').toEqual([
      ['Stazione'],
      ['Stazione', 'Roma'],
    ]);
    expect(successi()).toEqual([]);

    await risponde(1);
    expect(mondo.db).toEqual(['Stazione', 'Roma']);
    expect(scelte(d)).toEqual(['Stazione', 'Roma']);
    expect(successi()).toEqual(['Zone salvate']);
  });

  it('la scrittura appesa arriva tardi, dopo quella nuova: il database non resta con l’elenco vecchio, e un solo «salvate»', async () => {
    const d = await accendi();
    await tocca(d, 'Stazione');
    await tocca(d, 'Roma');
    await passa(10_000);
    await risponde(1); // la nuova riesce
    expect(successi()).toEqual(['Zone salvate']);

    await risponde(0); // la vecchia arriva adesso e rimette ['Stazione']
    await passa();
    const ultima = mondo.scritture.length - 1;
    expect(ultima, 'arrivata la scrittura vecchia, quella confermata non si riscrive').toBe(2);
    expect(mondo.scritture[ultima].zone).toEqual(['Stazione', 'Roma']);
    await risponde(ultima);
    expect(mondo.db, 'il database resta con l’elenco vecchio').toEqual(['Stazione', 'Roma']);
    expect(scelte(d)).toEqual(['Stazione', 'Roma']);
    expect(successi(), 'due «Zone salvate»').toEqual(['Zone salvate']);
  });

  it('l’ultimo tocco non risponde in tempo: lo dice e torna all’elenco confermato; se poi arriva riuscito, «Zone salvate»', async () => {
    const d = await accendi();
    await tocca(d, 'Stazione');
    await passa(10_000);
    expect(successi()).toEqual([]);
    expect(errori().length, 'scaduto il tempo il fattorino non sa niente').toBeGreaterThan(0);
    expect(scelte(d)).toEqual([]);

    await risponde(0);
    expect(mondo.db).toEqual(['Stazione']);
    expect(scelte(d)).toEqual(['Stazione']);
    expect(successi()).toEqual(['Zone salvate']);
  });
});
