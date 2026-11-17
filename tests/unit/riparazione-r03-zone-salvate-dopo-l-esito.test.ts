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

type Rispondi = (errore: { message: string } | null) => void;
const mondo = vi.hoisted(() => ({
  avvisi: [] as Array<{ tipo: string; testo: string }>,
  scritte: [] as unknown[],
  rispondi: null as null | Rispondi,
  /** Le scritture partite che aspettano ancora la risposta, nell'ordine di partenza. */
  attese: [] as Rispondi[],
  /** Le zone nel finto database: cambiano quando una scrittura riesce, nell'ordine in cui arrivano. */
  db: [] as string[],
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
      const patch = aggiornamento as { rider_zones?: string[] };
      return new Promise<{ data: null; error: { message: string } | null }>((fine) => {
        const rispondi: Rispondi = (errore) => {
          mondo.attese = mondo.attese.filter((r) => r !== rispondi);
          if (!errore && patch?.rider_zones) mondo.db = patch.rider_zones;
          fine({ data: null, error: errore });
        };
        mondo.rispondi = rispondi;
        mondo.attese.push(rispondi);
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
  mondo.attese = [];
  mondo.db = [];
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

/**
 * Giro di correzione (casi del revisore): due tocchi di fila, «Stazione» e poi «Roma», prima che la
 * prima scrittura risponda. Il finto server risponde a tutte le scritture in attesa, una alla volta,
 * nell'ordine che dice la prova; quelle che partono dopo una risposta entrano nel giro.
 */
async function rispondiATutte(esito: (n: number) => { message: string } | null, ordine: 'partenza' | 'inversa') {
  for (let n = 0; mondo.attese.length > 0 && n < 10; n++) {
    const prossima = ordine === 'partenza' ? mondo.attese[0] : mondo.attese[mondo.attese.length - 1];
    await act(async () => { prossima(esito(n)); });
    await lascia();
  }
}

async function toccaStazioneERoma() {
  const d = await accendi();
  await act(async () => { zona(d, 'Stazione')!.click(); });
  await act(async () => { zona(d, 'Roma')!.click(); });
  await lascia();
  expect(zona(d, 'Roma')!.getAttribute('aria-pressed'), 'il secondo tocco si vede subito').toBe('true');
  return d;
}

const scelteASchermo = (d: HTMLElement) =>
  [...d.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent?.trim() ?? '');

describe('R03-008 giro di correzione — due tocchi prima dell’esito', () => {
  it('«Stazione» e «Roma», tutte e due le scritture cadono nell’ordine di partenza: lo schermo torna al database', async () => {
    const d = await toccaStazioneERoma();
    await rispondiATutte(() => ({ message: 'rete giù' }), 'partenza');
    expect(mondo.db, 'nel database non è entrato niente').toEqual([]);
    expect(scelteASchermo(d), 'lo schermo mostra zone scelte col database vuoto').toEqual([]);
    expect(successi()).toEqual([]);
  });

  it('due scritture che riescono ma arrivano in ordine inverso: lo schermo mostra quello che il database tiene, e un solo «salvate»', async () => {
    const d = await toccaStazioneERoma();
    await rispondiATutte(() => null, 'inversa');
    expect(scelteASchermo(d)).toEqual(['Stazione', 'Roma']);
    expect(mondo.db, 'il database tiene un elenco diverso da quello a schermo').toEqual(['Stazione', 'Roma']);
    expect(successi(), '«Zone salvate» deve comparire una volta, quando lo schermo è davvero salvato').toEqual(['Zone salvate']);
  });

  it('la prima riesce e la seconda cade: lo schermo torna all’ultimo elenco salvato, e niente «salvate» a metà', async () => {
    const d = await toccaStazioneERoma();
    await rispondiATutte((n) => (n === 0 ? null : { message: 'rete giù' }), 'partenza');
    expect(mondo.db).toEqual(['Stazione']);
    expect(scelteASchermo(d), 'lo schermo deve tornare all’ultimo elenco confermato').toEqual(['Stazione']);
    expect(successi(), '«Zone salvate» mentre lo schermo mostrava anche Roma, non salvata').toEqual([]);
  });
});
