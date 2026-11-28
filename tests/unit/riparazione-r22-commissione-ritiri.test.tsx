// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna, contantiDaStripeVuota } from './aiuti/cabina-admin';

/**
 * R22-002 — Il pannello dei bonifici dice quanto versare a ogni negozio il lunedì, meno la
 * commissione dei ritiri pagati al banco, e il bonifico segnato resta col suo importo vero.
 *
 * Regola ritiro.in-negozio: sui ritiri pagati in contanti al banco la commissione MyCity si toglie
 * dal bonifico del lunedì; se non basta, va nella fattura del mese. Prima: la cifra del lunedì era
 * il netto pieno dei contanti, «Già pagato» contava il netto pieno anche dove una commissione era
 * stata trattenuta, e con la commissione sopra i contanti il tasto chiedeva il CRO di un bonifico
 * da 0,00 € e il resto da fatturare spariva. E la nota diceva «automatico» anche a carta spenta.
 * Il finto server applica filtri, ordinamento e limite come quello vero.
 * Orologio finto: lunedì 23/11/2026 (settimana prima: 16-22/11, ora di Roma).
 */

type Riga = Record<string, unknown>;
const stato = vi.hoisted(() => ({
  ordini: [] as Record<string, unknown>[],
  manuali: [] as Record<string, unknown>[],
  chiamate: [] as Record<string, unknown>[],
  letture: [] as string[],
  lancia: false,
}));

function spezza(s: string): string[] {
  const pezzi: string[] = [];
  let p = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') p++;
    if (ch === ')') p--;
    if (ch === ',' && p === 0) { pezzi.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) pezzi.push(cur);
  return pezzi.map((x) => x.trim());
}

/** Un filtro di PostgREST (`colonna.operatore.valore`, `and(...)`, `or(...)`) come funzione. */
function condizione(expr: string): (r: Riga) => boolean {
  const e = expr.trim();
  const logico = /^(not\.)?(and|or)\((.*)\)$/.exec(e);
  if (logico) {
    const parti = spezza(logico[3]).map(condizione);
    const f = logico[2] === 'and' ? (r: Riga) => parti.every((c) => c(r)) : (r: Riga) => parti.some((c) => c(r));
    return logico[1] ? (r) => !f(r) : f;
  }
  const punto = e.indexOf('.');
  const col = e.slice(0, punto);
  let resto = e.slice(punto + 1);
  const nega = resto.startsWith('not.');
  if (nega) resto = resto.slice(4);
  const p2 = resto.indexOf('.');
  const op = resto.slice(0, p2);
  const val = resto.slice(p2 + 1);
  const base = (r: Riga): boolean => {
    const v = r[col];
    switch (op) {
      case 'eq': return v !== null && v !== undefined && String(v) === val;
      case 'is': return val === 'null' ? v === null || v === undefined : String(v) === val;
      case 'in': return v !== null && v !== undefined && val.replace(/^\(|\)$/g, '').split(',').includes(String(v));
      default: throw new Error(`operatore non previsto dal finto server: ${op}`);
    }
  };
  return nega ? (r) => (op === 'is' ? !base(r) : r[col] !== null && r[col] !== undefined && !base(r)) : base;
}

function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  let ordine: { col: string; asc: boolean } | null = null;
  let limite = Infinity;
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { filtri.push(condizione(`${c}.eq.${String(v)}`)); return b; },
    is: (c: string, v: unknown) => { filtri.push(condizione(`${c}.is.${String(v)}`)); return b; },
    in: (c: string, v: unknown[]) => { filtri.push(condizione(`${c}.in.(${v.join(',')})`)); return b; },
    not: (c: string, op: string, v: unknown) => { filtri.push(condizione(`${c}.not.${op}.${String(v)}`)); return b; },
    or: (s: string) => { filtri.push(condizione(`or(${s})`)); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { ordine = { col: c, asc: o?.ascending !== false }; return b; },
    limit: (n: number) => { limite = n; return b; },
    then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      let righe = (nome === 'orders' ? stato.ordini : []).filter((r) => filtri.every((f) => f(r)));
      const totale = righe.length;
      if (ordine) {
        const { col, asc } = ordine;
        righe = [...righe].sort((x, y) => (asc ? 1 : -1) * String(x[col] ?? '').localeCompare(String(y[col] ?? '')));
      }
      righe = righe.slice(0, Math.min(limite, 1000));
      return Promise.resolve({ data: righe, error: null, count: totale }).then(ok, ko);
    },
  };
  return b;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => tabella(t),
    rpc: vi.fn(async (n: string, args: Record<string, unknown>) => {
      stato.letture.push(n);
      if (n === 'bonifici_manuali_per_mese') {
        if (stato.lancia) throw new Error('rete giù');
        return { data: stato.manuali, error: null };
      }
      if (n === 'contanti_da_recuperare') return { data: [], error: null };
      stato.chiamate.push({ n, ...args });
      return { data: (args.p_order_ids as string[]).length, error: null };
    }),
  },
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

let chiudi: (() => void) | null = null;
beforeEach(() => {
  // R05-002 (onda 2) — senza la risposta del server i contanti restano «In sospeso»: qui la variabile è vuota.
  vi.stubGlobal('fetch', contantiDaStripeVuota);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T08:00:00Z'));
  stato.chiamate = [];
  stato.manuali = [];
  stato.letture = [];
  stato.lancia = false;
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const forno = { store_name: 'Pane Quotidiano', billing_iban: 'IT60X0542811101000000123456' };
const bottega = { store_name: 'Bottega Verde', billing_iban: 'IT60X0542811101000000654321' };
const ordine = (id: string, extra: Riga): Riga => ({
  id, seller_id: 'forno', total_price: 20, seller_payout_cents: 1800, seller_payout_reversed_cents: 0, application_fee_cents: 200,
  dispute_status: null, internal_dispute_status: null, payment_status: 'PAID',
  payout_status: 'HELD', payout_at: null, stripe_transfer_id: null, delivery_status: 'DELIVERED',
  payment_method: 'cod', created_at: '2026-11-18T09:00:00Z', delivered_at: '2026-11-18T15:00:00Z',
  seller: forno, ...extra,
});
const contante = (id: string, netto: number, giorno: string, extra: Riga = {}) =>
  ordine(id, { seller_payout_cents: netto, created_at: `${giorno}T09:00:00Z`, delivered_at: `${giorno}T15:00:00Z`, ...extra });
const ritiro = (id: string, commissione: number, giorno: string, extra: Riga = {}) =>
  ordine(id, {
    payout_status: 'CASH_IN_STORE', application_fee_cents: commissione, seller_payout_cents: commissione * 9,
    created_at: `${giorno}T09:00:00Z`, delivered_at: `${giorno}T15:00:00Z`, ...extra,
  });

async function apri() {
  const mod = (await import('@/app/admin/payouts/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

const riquadri = (host: HTMLElement) => Array.from(host.querySelectorAll('p.text-\\[26px\\]')).map((p) => p.textContent ?? '');
function bloccoDi(host: HTMLElement, negozio: string): HTMLElement {
  const nome = Array.from(host.querySelectorAll('p')).find((p) => p.textContent === negozio);
  return nome!.closest('div.overflow-hidden') as HTMLElement;
}
function daVersareLunedi(blocco: HTMLElement): string {
  const etichetta = Array.from(blocco.querySelectorAll('p')).find((p) => p.textContent === 'Da versare lunedì');
  return etichetta?.nextElementSibling?.textContent ?? '';
}
const tastoIn = (blocco: HTMLElement) => blocco.querySelector('button') as HTMLButtonElement | null;
async function premi(tasto: HTMLButtonElement) {
  await act(async () => { tasto.click(); await new Promise((ok) => setTimeout(ok, 20)); });
}

describe('R22-002 — il bonifico del lunedì toglie la commissione dei ritiri al banco, e resta scritto', () => {
  it('31,50 € di contanti meno 3,50 € di commissione: il lunedì si versano 28,00 €, e alla funzione vanno ritiro e importo', async () => {
    stato.ordini = [
      contante('c1', 1350, '2026-11-18'),
      contante('c2', 1800, '2026-11-19'),
      ritiro('r1', 350, '2026-11-20'),
      // Già regolato con un bonifico di prima: non si trattiene due volte.
      ritiro('r0', 500, '2026-11-10', { payout_at: '2026-11-16T08:00:00Z' }),
      // Di questa settimana: aspetta il lunedì dopo.
      contante('c9', 900, '2026-11-23', { delivered_at: '2026-11-23T07:00:00Z' }),
    ];
    const host = await apri();
    const blocco = bloccoDi(host, 'Pane Quotidiano');

    expect(daVersareLunedi(blocco), 'la commissione dei ritiri al banco non si toglie dal bonifico').toMatch(/28,00/);
    expect(blocco.textContent).toMatch(/contanti 31,50\s*€ − 3,50\s*€ di commissione dei ritiri al banco/);
    expect(blocco.textContent).toMatch(/\+ 9,00\s*€ di questa settimana/);
    expect(riquadri(host)[0], '«Contanti da versare» conta anche la commissione da trattenere').toMatch(/37,00/);

    const tasto = tastoIn(blocco);
    expect(tasto?.textContent).toMatch(/Bonifico fatto · 28,00/);
    const prompt = vi.fn((_testo?: string) => 'CRO-0099887766');
    vi.stubGlobal('prompt', prompt);
    await premi(tasto!);
    expect(String(prompt.mock.calls[0]?.[0] ?? '')).toMatch(/28,00/);
    expect(stato.chiamate[0]).toMatchObject({
      n: 'segna_bonifico_manuale',
      p_seller: 'forno',
      p_order_ids: expect.arrayContaining(['c1', 'c2']),
      p_ritiri: ['r1'],
      p_importo_cents: 2800,
      p_riferimento: 'CRO-0099887766',
    });
    expect(stato.chiamate[0].p_order_ids).toHaveLength(2);
  });

  it('dopo il bonifico «Già pagato» e la riga del negozio dicono 28,00 €, quelli partiti davvero', async () => {
    stato.ordini = [
      contante('c1', 1350, '2026-11-18', { payout_status: 'PAID_MANUALLY', payout_at: '2026-11-23T08:00:00Z' }),
      contante('c2', 1800, '2026-11-19', { payout_status: 'PAID_MANUALLY', payout_at: '2026-11-23T08:00:00Z' }),
      ritiro('r1', 350, '2026-11-20', { payout_at: '2026-11-23T08:00:00Z' }),
    ];
    stato.manuali = [{ seller_id: 'forno', mese: '2026-11', bonifici: 1, importo_cents: 2800, trattenuta_cents: 350, in_fattura_cents: 0 }];
    const host = await apri();
    const blocco = bloccoDi(host, 'Pane Quotidiano');

    expect(riquadri(host)[2], '«Già pagato» conta il netto pieno, non il bonifico partito').toMatch(/^28,00/);
    expect(blocco.textContent).toMatch(/28,00\s*€ già pagati/);
    expect(daVersareLunedi(blocco), 'il ritiro regolato torna a togliersi dal lunedì dopo').toMatch(/0,00/);
    expect(tastoIn(blocco), 'niente da segnare: nessun tasto').toBeNull();
  });

  it('commissione sopra i contanti: niente CRO per un bonifico da 0 €, e il resto va in fattura e resta scritto', async () => {
    stato.ordini = [
      contante('c3', 100, '2026-11-18', { seller_id: 'bottega', seller: bottega }),
      ritiro('r3', 300, '2026-11-19', { seller_id: 'bottega', seller: bottega }),
    ];
    const host = await apri();
    const blocco = bloccoDi(host, 'Bottega Verde');

    expect(daVersareLunedi(blocco)).toMatch(/0,00/);
    expect(blocco.textContent).toMatch(/2,00\s*€ di commissione non entrano nel bonifico: vanno nella fattura del mese/);
    const tasto = tastoIn(blocco);
    expect(tasto?.textContent, 'il tasto chiede un bonifico da 0,00 €').toBe('Segna la compensazione · nessun bonifico');

    const prompt = vi.fn(() => 'CRO-INESISTENTE');
    const confirm = vi.fn(() => true);
    vi.stubGlobal('prompt', prompt);
    vi.stubGlobal('confirm', confirm);
    await premi(tasto!);
    expect(prompt, 'chiede il CRO di un bonifico che non esiste').not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledOnce();
    expect(stato.chiamate[0]).toMatchObject({
      p_seller: 'bottega',
      p_order_ids: ['c3'],
      p_ritiri: ['r3'],
      p_importo_cents: 0,
      p_riferimento: null,
    });
  });

  it('il resto in fattura resta nel pannello anche dopo la compensazione', async () => {
    stato.ordini = [
      contante('c3', 100, '2026-11-18', { seller_id: 'bottega', seller: bottega, payout_status: 'PAID_MANUALLY', payout_at: '2026-11-23T08:00:00Z' }),
      ritiro('r3', 300, '2026-11-19', { seller_id: 'bottega', seller: bottega, payout_at: '2026-11-23T08:00:00Z' }),
    ];
    stato.manuali = [{ seller_id: 'bottega', mese: '2026-11', bonifici: 1, importo_cents: 0, trattenuta_cents: 100, in_fattura_cents: 200 }];
    const host = await apri();
    const blocco = bloccoDi(host, 'Bottega Verde');
    expect(blocco.textContent, 'la commissione da fatturare sparisce dopo la compensazione').toMatch(/2,00\s*€ di commissione in fattura \(novembre 2026\)/);
    expect(riquadri(host)[2], 'una compensazione non è un bonifico partito').toMatch(/^0,00/);
  });

  it('a carta spenta la pagina non dice che i bonifici partono da soli', async () => {
    stato.ordini = [contante('c1', 1350, '2026-11-18')];
    const host = await apri();
    expect(host.textContent).not.toMatch(/automatico/);
    expect(host.textContent).not.toMatch(/release-payouts/);
    expect(host.textContent).toMatch(/il bonifico lo fai tu il lunedì/);
  });
});

describe('R22-002 (giro di correzione) — credito MyCity sui ritiri, compensazione esatta, bonifico Stripe appeso', () => {
  it('un ritiro pagato in parte col credito MyCity: il negozio ha in cassa 15 €, MyCity gli deve 5 € − 2 € di commissione', async () => {
    stato.ordini = [
      contante('c1', 1000, '2026-11-18'),
      ritiro('r1', 200, '2026-11-19', { total_price: 15, wallet_applied_cents: 500 }),
    ];
    const host = await apri();
    const blocco = bloccoDi(host, 'Pane Quotidiano');
    expect(daVersareLunedi(blocco), 'il credito usato al banco non si restituisce al negozio').toMatch(/13,00/);
    expect(blocco.textContent).toMatch(/contanti 10,00\s*€ \+ 5,00\s*€ di credito MyCity dei ritiri al banco − 2,00\s*€ di commissione/);
    vi.stubGlobal('prompt', vi.fn(() => 'CRO-0099887766'));
    await premi(tastoIn(blocco)!);
    expect(stato.chiamate[0]).toMatchObject({ p_order_ids: ['c1'], p_ritiri: ['r1'], p_importo_cents: 1300 });
  });

  it('commissione uguale ai contanti: la conferma non parla di 0,00 € in fattura', async () => {
    stato.ordini = [contante('c1', 200, '2026-11-18'), ritiro('r1', 200, '2026-11-19')];
    const host = await apri();
    const confirm = vi.fn((_testo?: string) => true);
    vi.stubGlobal('confirm', confirm);
    await premi(tastoIn(bloccoDi(host, 'Pane Quotidiano'))!);
    const testo = String(confirm.mock.calls[0]?.[0] ?? '');
    expect(testo).toMatch(/Segno la compensazione\?/);
    expect(testo, 'dice che 0,00 € vanno in fattura').not.toMatch(/fattura/);
    expect(host.textContent).not.toMatch(/0,00\s*€ di commissione vanno nella fattura/);
  });

  it('un contante HELD con un bonifico Stripe già scritto non entra nel lunedì né nel tasto: resta fermo con la sua etichetta', async () => {
    stato.ordini = [
      contante('c1', 1800, '2026-11-18'),
      contante('c2', 900, '2026-11-17', { stripe_transfer_id: 'tr_appeso_0001' }),
    ];
    const host = await apri();
    const blocco = bloccoDi(host, 'Pane Quotidiano');
    expect(daVersareLunedi(blocco), 'la 916 lo rifiuta: il tasto resterebbe bloccato').toMatch(/18,00/);
    expect(blocco.textContent).toMatch(/Fermo: bonifico Stripe da controllare/);
    vi.stubGlobal('prompt', vi.fn(() => 'CRO-0099887766'));
    await premi(tastoIn(blocco)!);
    expect(stato.chiamate[0]).toMatchObject({ p_order_ids: ['c1'], p_importo_cents: 1800 });
  });
});

describe('R22-002 (giro corto) — la lettura dei bonifici a mano parte solo se serve e non fa cadere la pagina', () => {
  it('senza traccia di bonifici a mano la lettura per mese non parte: al server arriva solo il bonifico', async () => {
    stato.ordini = [contante('c1', 1350, '2026-11-18')];
    const host = await apri();
    const blocco = bloccoDi(host, 'Pane Quotidiano');
    expect(riquadri(host)[2], 'niente da leggere: «Già pagato» non è un minimo').not.toMatch(/almeno/);
    vi.stubGlobal('prompt', vi.fn(() => 'CRO-0011223344'));
    await premi(tastoIn(blocco)!);
    expect(stato.letture, 'la pagina chiama la lettura per mese senza un bonifico a mano').not.toContain('bonifici_manuali_per_mese');
    expect(stato.chiamate[0]).toMatchObject({ n: 'segna_bonifico_manuale', p_order_ids: ['c1'] });
  });

  it('con un contante versato a mano la lettura parte; esito strano o eccezione: «Già pagato» è un minimo e la pagina regge', async () => {
    const versato = () => [contante('c1', 1350, '2026-11-18', { payout_status: 'PAID_MANUALLY', payout_at: '2026-11-23T08:00:00Z' })];
    stato.ordini = versato();
    stato.manuali = { importo_cents: 1350 } as unknown as Record<string, unknown>[];
    let host = await apri();
    expect(stato.letture).toContain('bonifici_manuali_per_mese');
    expect(riquadri(host)[2], 'un esito che non è un elenco vale come lettura caduta').toMatch(/^almeno /);
    chiudi?.();
    chiudi = null;

    stato.ordini = versato();
    stato.lancia = true;
    host = await apri();
    expect(host.textContent, 'un\'eccezione nella lettura fa cadere la pagina').toMatch(/Pane Quotidiano/);
    expect(riquadri(host)[2]).toMatch(/^almeno /);
  });
});
