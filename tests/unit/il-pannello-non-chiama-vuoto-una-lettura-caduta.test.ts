/**
 * @vitest-environment jsdom
 */
/**
 * 26/10/2026 — NEL PANNELLO, «NON SONO RIUSCITO A LEGGERE» NON È «NON C'È NIENTE».
 *
 * Sei pagine dell'amministratore — rimesse contanti, bonifici ai negozi, reclami, assistenza,
 * prodotti e registro delle azioni — leggevano con `const { data: x = [], isLoading } = useQuery(…)`
 * e decidevano cosa mostrare solo su `isLoading`. Quattro buttavano anche l'errore della lettura
 * (`const { data } = await q`). Con la lettura caduta, il ripiego `= []` prendeva il posto del
 * dato: «Nessuna rimessa COD in attesa» con la spunta verde, «Nessun payout da riconciliare» con
 * 0,00 € nei riquadri, «0 di 0» prodotti. Su due di queste pagine si decide di soldi.
 *
 * In più reclami e registro chiedevano `profiles.email`, una colonna che nessuna migrazione ha
 * creato: PostgREST risponde 42703 a TUTTA la domanda, e la pagina mostrava un elenco vuoto anche
 * col database sano (il registro ha righe vere, la pagina non ne mostrava nessuna).
 *
 * ── Cosa prova questo file, per ognuna delle sei pagine ────────────────────────────────────
 * ① MONTA la pagina con la lettura caduta, nelle due forme (senza dato, e col ripiego vuoto in
 *    mano): niente frase di «vuoto», niente numeri, sì all'avviso con «Riprova».
 * ② ESEGUE la queryFn vera contro un database che scade: deve arrivare a React Query come
 *    errore, non come elenco vuoto.
 * ③ ESEGUE la queryFn vera contro un database che conosce le colonne vere (dai tipi generati
 *    dalle migrazioni, agganci compresi): nessun 42703, e le righe tornano.
 *
 * ⚪ Da qui non apro il pannello nel browser: verifico cosa esce a video e cosa fa la lettura.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { databaseCheConosceLeColonne } from './aiuti/database-che-conosce-le-colonne';

const G = globalThis as Record<string, unknown>;

type Pagina = {
  nome: string;
  file: string;
  /** La frase che la pagina scriveva su una lettura caduta. */
  vuoto: string;
  /** Un pezzo che non deve comparire: un numero detto senza averlo letto. */
  numeri?: string;
  /** La tabella della lettura principale. */
  tabella: string;
};

const PAGINE: Pagina[] = [
  { nome: 'rimesse contanti', file: 'app/admin/cod-remittance/page.tsx', vuoto: 'Nessuna rimessa COD in attesa', numeri: 'totale da rimettere', tabella: 'orders' },
  { nome: 'bonifici ai negozi', file: 'app/admin/payouts/page.tsx', vuoto: 'Nessun payout da riconciliare', numeri: 'Da pagare (pronto)', tabella: 'orders' },
  { nome: 'reclami', file: 'app/admin/disputes/page.tsx', vuoto: 'Nessun reclamo in questo stato', tabella: 'disputes' },
  { nome: 'assistenza', file: 'app/admin/support/page.tsx', vuoto: 'Nessun messaggio in questo stato', tabella: 'contact_messages' },
  { nome: 'prodotti', file: 'app/admin/products/page.tsx', vuoto: '0 di 0', tabella: 'products' },
  { nome: 'registro delle azioni', file: 'app/admin/audit/page.tsx', vuoto: 'Nessuna voce nel log', tabella: 'audit_logs' },
];

type OpzioniQuery = { queryKey?: unknown; queryFn: (contesto: unknown) => Promise<unknown> };

/** Monta la pagina solo per farle dichiarare le sue letture, e restituisce la principale. */
async function letturaPrincipale(file: string): Promise<OpzioniQuery> {
  const opzioni: OpzioniQuery[] = [];
  G.__OPZIONI_QUERY__ = opzioni;
  const mod = await monta(file);
  const s = accendi(mod.default as ComponentType);
  s.smonta();
  expect(opzioni.length, `${file} non ha dichiarato nessuna lettura`).toBeGreaterThan(0);
  return opzioni[0];
}

const contesto = (o: OpzioniQuery) => ({ queryKey: o.queryKey, signal: new AbortController().signal, meta: undefined });

afterEach(() => {
  for (const k of ['__ESITO_QUERY__', '__DATI_QUERY__', '__OPZIONI_QUERY__', '__CLIENT_SUPABASE__']) delete G[k];
  document.body.innerHTML = '';
});

describe.each(PAGINE)('pannello · $nome', (p) => {
  it.each([
    ['senza niente in mano', undefined],
    ['col ripiego vuoto in mano', []],
  ])('lettura caduta %s: dice che non ha letto, non che è vuoto', async (_forma, data) => {
    G.__ESITO_QUERY__ = { isError: true, isSuccess: false, error: new Error('statement timeout'), data };
    const mod = await monta(p.file);
    const s = accendi(mod.default as ComponentType);
    const testo = s.radice.textContent ?? '';

    expect(testo, `«${p.vuoto}» su una lettura caduta: è uno zero che nessuno ha letto`).not.toContain(p.vuoto);
    if (p.numeri) expect(testo, 'i riquadri dei soldi non si mostrano senza dati').not.toContain(p.numeri);
    expect(testo, 'deve dire che non è riuscita a leggere').toContain('Non riesco a leggere');
    expect(s.radice.querySelector('[role="alert"] button'), 'e offrire di riprovare').not.toBeNull();
    s.smonta();
  });

  it('la lettura che scade arriva a React Query come errore, non come elenco vuoto', async () => {
    G.__CLIENT_SUPABASE__ = databaseCheConosceLeColonne({}, { cade: true });
    const principale = await letturaPrincipale(p.file);
    await expect(principale.queryFn(contesto(principale))).rejects.toMatchObject({ code: '57014' });
  });

  it('chiede solo colonne che esistono (agganci compresi): col database sano le righe tornano', async () => {
    const db = databaseCheConosceLeColonne({ [p.tabella]: [{ id: 'riga-1' }] });
    G.__CLIENT_SUPABASE__ = db;
    const principale = await letturaPrincipale(p.file);
    const righe = await principale.queryFn(contesto(principale)).catch((e: unknown) => e);

    expect(db.errori, 'una colonna che non esiste fa fallire tutta la domanda (42703)').toEqual([]);
    expect(righe, 'col database sano la pagina deve ricevere la riga che c’è').toHaveLength(1);
  });
});

/**
 * 27/10/2026 — UN ELENCO TAGLIATO NON SI SPACCIA PER INTERO.
 *
 * Payout e prodotti leggono al massimo 1000 righe (payout: `.limit(1000)`; prodotti: il tetto di
 * PostgREST). Arrivati al tetto, i riquadri «Da pagare» sommano solo quello che è stato letto e
 * «1000 di 1000» prodotti sembra il catalogo intero. Al tetto la pagina deve dirlo; sotto il tetto no.
 */
const TETTO = 1000;
const RIGHE_TAGLIATE: Array<{ nome: string; file: string; riga: (i: number) => Record<string, unknown> }> = [
  {
    nome: 'bonifici ai negozi',
    file: 'app/admin/payouts/page.tsx',
    riga: (i) => ({
      id: `ordine-${i}`, seller_id: 'negozio-1', total_price: 10, seller_payout_cents: 900, payout_status: 'PENDING',
      payout_at: null, stripe_transfer_id: null, delivery_status: 'DELIVERED', payment_method: 'card',
      created_at: '2026-10-01T10:00:00Z', seller: { store_name: 'Pane Quotidiano', billing_iban: null },
    }),
  },
  {
    nome: 'prodotti',
    file: 'app/admin/products/page.tsx',
    riga: (i) => ({
      id: `prodotto-${i}`, name: `Pane ${i}`, price: 3, stock: 5, status: 'active', images: [],
      external_marketplace: null, external_synced_at: null, seller: { store_name: 'Pane Quotidiano' }, categories: { name: 'Pane' },
    }),
  },
];

describe.each(RIGHE_TAGLIATE)('pannello · $nome · elenco al tetto', (p) => {
  it.each([
    ['al tetto', TETTO, true],
    ['sotto il tetto', 3, false],
  ])('%s: dice se l’elenco è tagliato', async (_caso, quante, tagliato) => {
    G.__DATI_QUERY__ = Array.from({ length: quante as number }, (_, i) => p.riga(i));
    const mod = await monta(p.file);
    const s = accendi(mod.default as ComponentType);
    const testo = s.radice.textContent ?? '';

    if (tagliato) expect(testo, `${TETTO} righe lette: l’elenco può essere più lungo, va detto`).toContain('Elenco tagliato');
    else expect(testo).not.toContain('Elenco tagliato');
    s.smonta();
    // Mille righe in jsdom: sotto il carico della suite intera i 5 secondi di default non bastano.
  }, 30_000);
});
