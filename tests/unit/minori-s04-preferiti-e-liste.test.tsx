/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * 5/11/2026 (S04) — Preferiti e Liste dicevano «non ne hai» a chi non poteva vederle:
 *  - a chi non ha fatto l'accesso (159);
 *  - a chi ha i preferiti tutti finiti per oggi (1630);
 *  - quando la lettura cade (428, 1548), o mentre la lista sta ancora caricando (428).
 * La lista vuota mostrava una nota da programmatori a chiunque (1715), e quattro azioni del
 * proprietario fallivano senza dire niente (1716).
 */

const avvisi = vi.hoisted(() => ({ ok: [] as string[], ko: [] as string[] }));
vi.mock('sonner', () => ({
  toast: { success: (t: string) => avvisi.ok.push(t), error: (t: string) => avvisi.ko.push(t) },
}));

/** Quello che la lettura restituisce a chi non ha fatto l'accesso. */
const OSPITE: unknown = null;
const g = globalThis as Record<string, unknown>;
type Opzioni = { queryKey: unknown[]; queryFn: () => Promise<unknown> };

afterEach(() => {
  for (const k of ['__DATI_QUERY__', '__ESITO_QUERY__', '__OPZIONI_QUERY__', '__RISPOSTA_SUPABASE__', '__UTENTE__',
    '__CLIENT_SUPABASE__', '__MUTAZIONI_VERE__', '__MUTAZIONI_IN_VOLO__']) delete g[k];
  avvisi.ok.length = 0;
  avvisi.ko.length = 0;
  document.body.innerHTML = '';
});

async function monto(file: string, props: Record<string, unknown> = {}) {
  const mod = await monta(file);
  const s = accendi(mod.default, props);
  await attendi();
  return s;
}

/** Fa girare la lettura vera della pagina contro un database finto che risponde come dice `risposta`. */
async function eseguiLettura(o: Opzioni, risposta: (tavola: string, opz?: unknown) => unknown) {
  const catena = (tavola: string) => {
    let opz: unknown;
    const c: Record<string, unknown> = {};
    for (const m of ['eq', 'in', 'order', 'limit', 'gt', 'gte', 'neq', 'is']) c[m] = () => c;
    c.select = (_: string, o2?: unknown) => { opz = o2; return c; };
    c.maybeSingle = async () => risposta(tavola, opz);
    c.single = c.maybeSingle;
    c.then = (r: (v: unknown) => unknown) => Promise.resolve(risposta(tavola, opz)).then(r);
    return c;
  };
  g.__CLIENT_SUPABASE__ = { from: catena, rpc: async () => ({ data: [], error: null }) };
  try {
    return await o.queryFn();
  } finally {
    delete g.__CLIENT_SUPABASE__;
  }
}

describe('Preferiti', () => {
  it('a chi non ha fatto l’accesso non dice «nessun preferito», lo manda ad accedere (159)', async () => {
    const opzioni: Opzioni[] = [];
    g.__OPZIONI_QUERY__ = opzioni;
    await monto('app/favorites/page.tsx');
    const letto = await eseguiLettura(opzioni[0], () => ({ data: [], error: null }));
    expect(letto).toBeNull();

    document.body.innerHTML = '';
    g.__DATI_QUERY__ = null;
    const s = await monto('app/favorites/page.tsx');
    const testo = testoVisibile(s.radice);
    expect(testo).not.toMatch(/Nessun preferito/);
    expect(testo).toMatch(/Accedi/);
    expect(s.radice.querySelector('a[href^="/sign-in"]')).not.toBeNull();
  });

  it('con i preferiti tutti finiti per oggi non dice «nessun preferito» (1630)', async () => {
    g.__UTENTE__ = { id: 'u-maria' };
    const opzioni: Opzioni[] = [];
    g.__OPZIONI_QUERY__ = opzioni;
    await monto('app/favorites/page.tsx');
    // Il database vede due cuoricini, ma i due prodotti sono esauriti: la regola li nasconde.
    const letto = (await eseguiLettura(opzioni[0], (tavola, opz) =>
      tavola === 'favorites' && (opz as { head?: boolean } | undefined)?.head
        ? { data: null, count: 2, error: null }
        : { data: [{ product_id: 'p1', products: null }, { product_id: 'p2', products: null }], error: null },
    )) as { prodotti: unknown[]; salvati: number };
    expect(letto.prodotti).toEqual([]);
    expect(letto.salvati).toBe(2);

    document.body.innerHTML = '';
    g.__DATI_QUERY__ = letto;
    const s = await monto('app/favorites/page.tsx');
    const testo = testoVisibile(s.radice);
    expect(testo).not.toMatch(/Nessun preferito/);
    expect(testo).toMatch(/non sono disponibili/);
  });
});

describe('Liste', () => {
  it('a chi non ha fatto l’accesso non dice «non hai ancora liste», lo manda ad accedere (159)', async () => {
    const opzioni: Opzioni[] = [];
    g.__OPZIONI_QUERY__ = opzioni;
    await monto('app/lists/page.tsx');
    const mie = opzioni.find((o) => o.queryKey.includes('mine'))!;
    expect(await eseguiLettura(mie, () => ({ data: [], error: null }))).toBeNull();

    document.body.innerHTML = '';
    g.__DATI_QUERY__ = (o: Opzioni): unknown => (o.queryKey.includes('mine') ? OSPITE : []);
    const s = await monto('app/lists/page.tsx');
    const testo = testoVisibile(s.radice);
    expect(testo).not.toMatch(/Non hai ancora liste/);
    expect(s.radice.querySelector('a[href^="/sign-in"]')).not.toBeNull();
  });

  it('con le letture cadute non dice «non hai liste» né «nessuna lista pubblica» (1548)', async () => {
    g.__UTENTE__ = { id: 'u-maria' };
    const opzioni: Opzioni[] = [];
    g.__OPZIONI_QUERY__ = opzioni;
    await monto('app/lists/page.tsx');
    for (const o of opzioni) {
      await expect(eseguiLettura(o, () => ({ data: null, error: { message: 'rete caduta' } }))).rejects.toBeTruthy();
    }

    document.body.innerHTML = '';
    g.__DATI_QUERY__ = undefined;
    g.__ESITO_QUERY__ = { data: undefined, isError: true, isSuccess: false };
    const s = await monto('app/lists/page.tsx');
    const testo = testoVisibile(s.radice);
    expect(testo).not.toMatch(/Non hai ancora liste/);
    expect(testo).not.toMatch(/Nessuna lista pubblica/);
    expect(testo).toMatch(/Non riesco a leggere le tue liste/);
    expect(testo).toMatch(/Non riesco a leggere le liste della community/);
  });
});

describe('Una lista', () => {
  const LISTA = {
    id: 'L1', owner_id: 'u-amica', title: 'Colazione della domenica', description: null,
    cover_emoji: null, is_public: true, updated_at: '2026-11-01T10:00:00Z', owner: null,
  };
  const pagina = () => monto('app/lists/[id]/page.tsx', { params: { id: 'L1' } });

  it('mentre carica non dice «Lista non trovata» (428)', async () => {
    g.__ESITO_QUERY__ = { data: undefined, isLoading: true, isPending: true, isSuccess: false };
    const s = await pagina();
    expect(testoVisibile(s.radice)).not.toMatch(/non trovata/i);
  });

  it('con la rete caduta non dice «forse è stata cancellata», offre Riprova (428)', async () => {
    g.__ESITO_QUERY__ = (o: Opzioni) =>
      o.queryKey.includes('L1') ? { data: undefined, isError: true, isSuccess: false } : undefined;
    const s = await pagina();
    const testo = testoVisibile(s.radice);
    expect(testo).not.toMatch(/non trovata|cancellata o non è pubblica/i);
    expect(testo).toMatch(/Non riesco a leggere la lista/);
  });

  it('le letture cadute fanno cadere la query (428)', async () => {
    const opzioni: Opzioni[] = [];
    g.__OPZIONI_QUERY__ = opzioni;
    g.__DATI_QUERY__ = (o: Opzioni) => (o.queryKey.includes('items') ? [] : LISTA);
    await pagina();
    expect(opzioni.length).toBeGreaterThanOrEqual(2);
    for (const o of opzioni) {
      await expect(eseguiLettura(o, () => ({ data: null, error: { message: 'rete caduta' } }))).rejects.toBeTruthy();
    }
  });

  it('una lista vuota non mostra la nota da programmatori a chi la visita (1715)', async () => {
    g.__UTENTE__ = { id: 'u-giulia' };
    g.__DATI_QUERY__ = (o: Opzioni) => (o.queryKey.includes('items') ? [] : LISTA);
    const s = await pagina();
    await attendi();
    const testo = testoVisibile(s.radice);
    expect(testo).toMatch(/vuota/);
    expect(testo).not.toMatch(/futuro/);
    expect(testo).not.toMatch(/Aggiungi prodotti|Aggiungi a lista/);
  });

  it('rendere privata la lista che non si scrive lo dice (1716)', async () => {
    g.__UTENTE__ = { id: 'u-amica' };
    g.__MUTAZIONI_VERE__ = true;
    const inVolo: Promise<unknown>[] = [];
    g.__MUTAZIONI_IN_VOLO__ = inVolo;
    g.__DATI_QUERY__ = (o: Opzioni) =>
      o.queryKey.includes('items')
        ? [{ list_id: 'L1', product_id: 'p1', sort_order: 0, note: null, product: { id: 'p1', name: 'Focaccia', price: 3, images: null, status: 'available' } }]
        : LISTA;
    g.__RISPOSTA_SUPABASE__ = { data: null, error: { message: 'rete caduta' } };
    const s = await pagina();
    await attendi();
    for (const nome of ['Rendi privata', 'Rimuovi']) {
      const b = s.radice.querySelector(`button[aria-label="${nome}"]`)!;
      expect(b, nome).not.toBeNull();
      s.agisci(() => clicca(b));
    }
    const nota = s.radice.querySelector('input[aria-label^="Perché hai messo"]') as HTMLInputElement;
    nota.value = 'buonissima';
    s.agisci(() => { nota.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })); });
    await Promise.all(inVolo);
    expect(inVolo.length).toBe(3);
    expect(avvisi.ko).toHaveLength(3);
    expect(avvisi.ko[0]).toMatch(/ancora pubblica/);
    expect(avvisi.ok).toEqual([]);
  });
});
