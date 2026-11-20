// @vitest-environment jsdom
/**
 * R02-018 — L'elenco dei negozi faceva una domanda sulla consegna veloce per ogni scheda.
 *
 * Ogni scheda (StoreListRow, StorePreviewCard, HeroStoreCard, la vetrina) chiama `useVeloceDelNegozio`
 * col suo negozio, e il gancio chiedeva /api/consegna/veloce per conto suo: duecento schede, duecento
 * domande contro lo stesso freno per indirizzo del carrello. Unire le domande su quella rotta non
 * bastava: risponde UN sì o no per tutti i negozi insieme, e ogni scheda avrebbe letto il verdetto di
 * tutta la lista. Adesso le schede dello stesso giro partono insieme verso /api/consegna/veloce/negozi,
 * che risponde negozio per negozio, e ogni scheda legge il SUO esito.
 *
 * Qui: il gancio vero con cinque schede (una domanda sola, esiti diversi per negozi diversi), una
 * scheda sola come prima, e la rotta nuova con un database finto e l'orologio finto.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useVeloceDelNegozio } from '@/components/ui/DeliveryCutoff';

const stato = vi.hoisted(() => ({
  profili: [] as Array<Record<string, unknown>>,
  rotto: false,
}));

type Filtro = [string, unknown];
function dbFinto() {
  return {
    from(_tabella: string) {
      const filtri: Filtro[] = [];
      let soloConteggio = false;
      let inId: string[] | null = null;
      const q = {
        select: (_c: string, o?: { head?: boolean }) => { soloConteggio = !!o?.head; return q; },
        eq: (c: string, v: unknown) => { filtri.push([c, v]); return q; },
        in: (_c: string, v: string[]) => { inId = v; return q; },
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          if (stato.rotto) return Promise.resolve({ data: null, count: null, error: { message: 'giù' } }).then(ok, ko);
          const righe = stato.profili.filter(
            (r) => filtri.every(([c, v]) => r[c] === v) && (inId === null || inId.includes(String(r.id))),
          );
          return Promise.resolve(soloConteggio ? { count: righe.length, error: null } : { data: righe, error: null }).then(ok, ko);
        },
      };
      return q;
    },
  };
}
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => dbFinto() }));

import { GET } from '@/app/api/consegna/veloce/negozi/route';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const id = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const FORNO = id(1);
const MACELLERIA = id(2);
const FIORAIO = id(3);
const LIBRERIA = id(4);
const ENOTECA = id(5);

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  stato.profili = [];
  stato.rotto = false;
});

const visti = new Map<string, boolean | null>();
function Scheda({ negozio }: { negozio: string }) {
  visti.set(negozio, useVeloceDelNegozio(negozio, true));
  return null;
}
function Lista({ negozi }: { negozi: string[] }) {
  return createElement('div', null, ...negozi.map((n) => createElement(Scheda, { key: n, negozio: n })));
}

/** La cassa finta: la rotta della lista risponde negozio per negozio, quella del carrello un sì/no solo. */
function cassaFinta(esiti: Record<string, boolean>) {
  const chiamate: string[] = [];
  vi.stubGlobal('fetch', vi.fn((url: unknown) => {
    const u = String(url);
    chiamate.push(u);
    const chiesti = (new URL(u, 'https://mycity.test').searchParams.get('negozi') ?? '').split(',').filter(Boolean);
    if (u.startsWith('/api/consegna/veloce/negozi')) {
      const mappa = Object.fromEntries(chiesti.filter((n) => n in esiti).map((n) => [n, esiti[n] ? { possibile: true } : { possibile: false, perche: 'no' }]));
      return Promise.resolve(new Response(JSON.stringify({ esiti: mappa })));
    }
    // /api/consegna/veloce: un verdetto solo per tutti i negozi chiesti (è la domanda del carrello).
    return Promise.resolve(new Response(JSON.stringify({ possibile: chiesti.every((n) => esiti[n]) })));
  }));
  return chiamate;
}

async function monta(negozi: string[]) {
  visti.clear();
  const c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root!.render(createElement(Lista, { negozi })));
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('R02-018 · il gancio: una domanda per tutta la lista, e a ogni scheda il suo esito', () => {
  it('cinque schede → una domanda sola, con tutti e cinque i negozi', async () => {
    const chiamate = cassaFinta({ [FORNO]: true, [MACELLERIA]: false, [FIORAIO]: true, [LIBRERIA]: false, [ENOTECA]: true });
    await monta([FORNO, MACELLERIA, FIORAIO, LIBRERIA, ENOTECA]);
    expect(chiamate, 'ogni scheda chiede per conto suo').toHaveLength(1);
    expect(chiamate[0]).toMatch(/^\/api\/consegna\/veloce\/negozi\?negozi=/);
    for (const n of [FORNO, MACELLERIA, FIORAIO, LIBRERIA, ENOTECA]) expect(chiamate[0]).toContain(n);
  });

  it('due negozi con esiti diversi: ogni scheda mostra il SUO, non quello della lista', async () => {
    cassaFinta({ [FORNO]: true, [MACELLERIA]: false });
    await monta([FORNO, MACELLERIA]);
    expect(visti.get(FORNO), 'il forno può la veloce').toBe(true);
    expect(visti.get(MACELLERIA), 'la macelleria no').toBe(false);
  });

  it('un negozio che la risposta non nomina resta «non so» (null), non «no»', async () => {
    cassaFinta({ [FORNO]: true });
    await monta([FORNO, FIORAIO]);
    expect(visti.get(FORNO)).toBe(true);
    expect(visti.get(FIORAIO)).toBeNull();
  });

  it('tornando sulla pagina dopo più di 5 minuti le schede richiedono insieme: ancora una domanda sola', async () => {
    const chiamate = cassaFinta({ [FORNO]: true, [MACELLERIA]: false, [FIORAIO]: true });
    await monta([FORNO, MACELLERIA, FIORAIO]);
    const adesso = Date.now();
    const orologio = vi.spyOn(Date, 'now').mockReturnValue(adesso + 6 * 60_000);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    for (let i = 0; i < 2; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    orologio.mockRestore();
    expect(chiamate).toHaveLength(2);
    expect(visti.get(MACELLERIA)).toBe(false);
  });

  it('una scheda sola (la scheda prodotto) chiede come prima, alla rotta del negozio', async () => {
    const chiamate = cassaFinta({ [FORNO]: true });
    await monta([FORNO]);
    expect(chiamate).toEqual([`/api/consegna/veloce?negozi=${encodeURIComponent(FORNO)}`]);
    expect(visti.get(FORNO)).toBe(true);
  });
});

const SEMPRE_APERTO = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => [k, [['00:00', '23:59']]]));
const SEMPRE_CHIUSO = { mon: [['05:00', '05:01']] };
const negozio = (idNegozio: string, nome: string, orari: unknown, approvato = true) =>
  ({ id: idNegozio, role: 'seller', is_approved: approvato, store_name: nome, store_hours: orari });
const fattorino = { id: 'r1', role: 'rider', is_approved: true, rider_is_online: true };

async function chiediLaLista(ids: string[], ip = '10.0.0.1') {
  const r = await GET(new Request(`https://mycity.test/api/consegna/veloce/negozi?negozi=${ids.join(',')}`, { headers: { 'x-forwarded-for': ip } }));
  return { status: r.status, corpo: (await r.json()) as { esiti: Record<string, { possibile: boolean; perche?: string }> } };
}

describe('R02-018 · la rotta della lista risponde negozio per negozio', () => {
  it('giovedì alle 10 a Piacenza, un fattorino online: il forno aperto sì, il fioraio chiuso no, ognuno col suo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T09:00:00Z'));
    stato.profili = [negozio(FORNO, 'Il forno', SEMPRE_APERTO), negozio(FIORAIO, 'Il fioraio', SEMPRE_CHIUSO), fattorino];
    const { status, corpo } = await chiediLaLista([FORNO, FIORAIO], '10.0.0.2');
    expect(status).toBe(200);
    expect(corpo.esiti[FORNO]).toEqual({ possibile: true });
    expect(corpo.esiti[FIORAIO].possibile).toBe(false);
    expect(corpo.esiti[FIORAIO].perche).toMatch(/fioraio/i);
  });

  it('un negozio non approvato vale «no» per lui solo, gli altri restano col loro esito', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T09:00:00Z'));
    stato.profili = [negozio(FORNO, 'Il forno', SEMPRE_APERTO), negozio(LIBRERIA, 'La libreria', SEMPRE_APERTO, false), fattorino];
    const { corpo } = await chiediLaLista([FORNO, LIBRERIA], '10.0.0.3');
    expect(corpo.esiti[FORNO]).toEqual({ possibile: true });
    expect(corpo.esiti[LIBRERIA].possibile).toBe(false);
  });

  it('se una lettura cade la risposta è «non so» (503, nessun esito), non «no» per tutti', async () => {
    stato.rotto = true;
    const { status, corpo } = await chiediLaLista([FORNO, FIORAIO], '10.0.0.4');
    expect(status).toBe(503);
    expect(corpo.esiti).toEqual({});
  });

  it('id che non sono negozi o più di 100 negozi: richiesta non valida', async () => {
    expect((await chiediLaLista(['non-un-id'], '10.0.0.5')).status).toBe(400);
    const troppi = Array.from({ length: 101 }, (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`);
    expect((await chiediLaLista(troppi, '10.0.0.6')).status).toBe(400);
  });
});
