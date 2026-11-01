/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { queryKeys } from '@/lib/queries/keys';
import { rigaScadenzaPerIlNegozio } from '@/lib/ordini/scadenza-accettazione';
import { monta, nomeAccessibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca, premi } from './aiuti/schermo';

/**
 * 31/10/2026 — LE DUE PAGINE ORDINI DEL NEGOZIO, MONTATE VERE.
 *
 * ① IL RIPIEGO SOLO SULLA COLONNA MANCANTE. La lettura chiede `payment_method` e le voci di prezzo;
 *    se cadeva per QUALSIASI motivo (un tempo scaduto, 57014) la pagina rileggeva senza quelle
 *    colonne, e un ordine in contanti si presentava «Carta (online)» con «Spedizione GRATUITA».
 *    Il ripiego e' per lo schema indietro (42703), non per il guasto.
 *
 * ② L'ORA DELLA RIGA «ENTRO QUANDO ACCETTARE». Si scriveva con l'ora dell'ultima lettura: con la
 *    pagina aperta o riaperta, e senza rete, restava quella di venerdi' sera anche sabato mattina.
 */

const ID = '11111111-2222-3333-4444-555555555555';
const ORDINE = {
  id: ID,
  user_id: 'maria',
  delivery_status: 'NEW',
  created_at: '2026-10-30T19:30:00.000Z',
  delivery_slot: 'Domani · 9:00–12:00',
  pickup_in_store: false,
  total_price: 23,
  shipping_cost: 0,
  payment_method: 'cod',
  seller: { store_hours: null },
  order_items: [],
};

type Pagina = { nome: string; file: string; chiave: readonly unknown[]; dato: unknown; props: Record<string, unknown> };
const PAGINE: Pagina[] = [
  { nome: 'il dettaglio ordine', file: 'app/seller/orders/[id]/page.tsx', chiave: queryKeys.seller.order(ID), dato: ORDINE, props: { params: { id: ID } } },
  { nome: 'la lista ordini', file: 'app/seller/orders/page.tsx', chiave: queryKeys.seller.orders, dato: [ORDINE], props: {} },
];
const componenti = new Map<string, ComponentType<Record<string, unknown>>>();

beforeAll(async () => {
  for (const p of PAGINE) componenti.set(p.file, (await monta(p.file)).default as ComponentType<Record<string, unknown>>);
}, 120000);

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__DATI_QUERY__;
  delete g.__RISPOSTA_SUPABASE__;
  delete g.__UTENTE__;
  vi.useRealTimers();
});

/** Monta la pagina e prende la `queryFn` vera della lettura degli ordini. */
async function letturaVera(p: Pagina): Promise<(arg?: unknown) => Promise<unknown>> {
  let presa: ((arg?: unknown) => Promise<unknown>) | null = null;
  (globalThis as Record<string, unknown>).__DATI_QUERY__ = (o: { queryKey: unknown[]; queryFn?: (arg?: unknown) => Promise<unknown> }) => {
    if (JSON.stringify(o.queryKey) === JSON.stringify(p.chiave) && o.queryFn) presa = o.queryFn;
    return undefined;
  };
  const s = accendi(componenti.get(p.file), p.props);
  await attendi();
  s.smonta();
  expect(presa, `${p.nome}: la lettura degli ordini non si trova`).toBeTruthy();
  return presa!;
}

/** Il database che cade alla prima lettura (quella con `payment_method`) con il codice dato. */
function databaseCheCade(codice: string): { letture: string[] } {
  const traccia = { letture: [] as string[] };
  (globalThis as Record<string, unknown>).__UTENTE__ = { id: "negozio-1" };
  (globalThis as Record<string, unknown>).__RISPOSTA_SUPABASE__ = ({ tavola, colonne }: { tavola: string; colonne: string }) => {
    if (tavola !== 'orders') return { data: null, error: null };
    traccia.letture.push(colonne);
    if (/payment_method/.test(colonne)) return { data: null, error: { code: codice, message: 'caduta' } };
    const { payment_method: _via, ...senza } = ORDINE;
    void _via;
    // Una riga sola in un elenco: la lista la legge cosi', il dettaglio ne prende la prima.
    return { data: [senza], error: null };
  };
  return traccia;
}

describe('① il ripiego scatta solo se manca una colonna, non su un guasto qualsiasi', () => {
  for (const p of PAGINE) {
    it(`${p.nome}: tempo scaduto (57014) → errore vero, nessuna lettura senza il metodo di pagamento`, async () => {
      const leggi = await letturaVera(p);
      const t = databaseCheCade('57014');
      await expect(leggi({ pageParam: 0 })).rejects.toMatchObject({ code: '57014' });
      expect(t.letture, 'la seconda lettura, senza payment_method, fa sembrare carta un ordine in contanti').toHaveLength(1);
    });

    it(`${p.nome}: colonna mancante (42703) → il ripiego c'e' ancora`, async () => {
      const leggi = await letturaVera(p);
      const t = databaseCheCade('42703');
      await expect(leggi({ pageParam: 0 })).resolves.toBeTruthy();
      expect(t.letture).toHaveLength(2);
    });
  }
});

describe('② «entro quando accettare» segue l’orologio, non l’ultima lettura', () => {
  const VENERDI = new Date('2026-10-30T19:30:05.000Z'); // 20:30 a Piacenza
  const SABATO = new Date('2026-10-31T07:30:10.000Z'); // 8:30 a Piacenza
  const riga = (quando: Date) => rigaScadenzaPerIlNegozio(ORDINE as never, quando, null);

  it('le due ore danno davvero due righe diverse (altrimenti la prova non guarda niente)', () => {
    expect(riga(VENERDI)).toBeTruthy();
    expect(riga(SABATO)).toBeTruthy();
    expect(riga(VENERDI)).not.toBe(riga(SABATO));
  });

  for (const p of PAGINE) {
    it(`${p.nome}: riaperta sabato mattina, la riga e' di sabato prima di ogni rilettura`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(VENERDI);
      (globalThis as Record<string, unknown>).__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
        JSON.stringify(o.queryKey) === JSON.stringify(p.chiave) ? p.dato : undefined;
      const s = accendi(componenti.get(p.file), p.props);
      await attendi();
      expect(s.radice.textContent).toContain(riga(VENERDI));

      vi.setSystemTime(SABATO);
      s.agisci(() => document.dispatchEvent(new Event('visibilitychange')));
      await attendi();
      const testo = s.radice.textContent ?? '';
      s.smonta();
      expect(testo).toContain(riga(SABATO));
      expect(testo).not.toContain(riga(VENERDI));
    });

    it(`${p.nome}: lasciata aperta e senza rete, la riga si riscrive da sola`, async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      vi.setSystemTime(VENERDI);
      (globalThis as Record<string, unknown>).__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
        JSON.stringify(o.queryKey) === JSON.stringify(p.chiave) ? p.dato : undefined;
      const s = accendi(componenti.get(p.file), p.props);
      await attendi();
      expect(s.radice.textContent).toContain(riga(VENERDI));

      vi.setSystemTime(SABATO);
      s.agisci(() => vi.advanceTimersByTime(20_000));
      await attendi();
      const testo = s.radice.textContent ?? '';
      s.smonta();
      expect(testo).toContain(riga(new Date()));
      expect(testo).not.toContain(riga(VENERDI));
    });
  }
});

/**
 * ③ IL RIQUADRO «RIFIUTARE L'ORDINE?» DEL NEGOZIANTE. Si dichiarava modale (aria-modal) ma
 *    sentiva solo Esc: alla chiusura il fuoco cadeva sul corpo della pagina invece di tornare su
 *    «Rifiuta», e il campo del motivo non aveva nome per chi usa uno screen reader.
 */
describe("③ il riquadro «Rifiutare l'ordine?» si comporta da modale", () => {
  it('il motivo ha un nome, Esc chiude e il fuoco torna su «Rifiuta»', async () => {
    const p = PAGINE[0];
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      JSON.stringify(o.queryKey) === JSON.stringify(p.chiave) ? p.dato : undefined;
    const s = accendi(componenti.get(p.file), p.props);
    await attendi();
    const rifiuta = Array.from(s.radice.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'Rifiuta');
    expect(rifiuta, 'il pulsante «Rifiuta» non c’è: la prova non guarda niente').toBeTruthy();
    rifiuta!.focus();
    s.agisci(() => clicca(rifiuta!));
    await attendi();
    const dialogo = document.querySelector('[role="dialog"]');
    expect(dialogo, 'il riquadro non si è aperto').toBeTruthy();
    expect(nomeAccessibile(dialogo!.querySelector('textarea')!)).toMatch(/Motivo del rifiuto/);
    s.agisci(() => premi('Escape'));
    await attendi();
    const fuoco = document.activeElement;
    const aperto = document.querySelector('[role="dialog"]');
    s.smonta();
    expect(aperto, 'Esc deve chiudere il riquadro').toBeNull();
    expect(fuoco, 'il fuoco deve tornare su «Rifiuta», non sul corpo della pagina').toBe(rifiuta);
  });
});
