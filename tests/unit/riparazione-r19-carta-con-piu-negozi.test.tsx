/**
 * @vitest-environment jsdom
 */
/**
 * R19-011 — Il buco nelle prove: con la CARTA e più negozi la cassa non deve tornare a dire
 * «ogni negozio fa consegnare il proprio». La prova della squadra monta solo la bozza 'cod':
 * qui si monta la bozza 'card' (chiave Stripe finta e carta accesa solo per questa prova)
 * con due negozi, e si legge il riquadro «prodotti da 2 negozi diversi».
 * Stessa impalcatura di la-veloce-resta-scelta-dopo-l-accesso.
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { act } from 'react';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_finta');

const avvisi = vi.hoisted(() => ({ errori: [] as string[] }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: () => undefined,
    info: () => undefined,
    error: (m: unknown) => {
      avvisi.errori.push(String(m));
    },
  }),
}));

/**
 * La carta oggi è spenta al lancio (`CARTA_ACCESA = false`, scelta di Nicola): il ramo carta della
 * cassa non si raggiunge con la pagina vera. Qui la pagina si compila come fa `monta`, ma con
 * l'interruttore acceso nel solo file di prova: nessun file del sito cambia.
 */
async function montaConCartaAccesa(): Promise<{ default: unknown }> {
  const radice = path.resolve(__dirname, '../..');
  const cartella = path.join(radice, 'tests', 'unit', '.montati', `carta-${process.pid}`);
  mkdirSync(cartella, { recursive: true });
  const uscita = path.join(cartella, 'cassa.mjs');
  execFileSync(process.execPath, [path.join(__dirname, 'aiuti', 'compila.mjs'), 'app/checkout/page.tsx', uscita], {
    cwd: radice,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const compilato = readFileSync(uscita, 'utf8');
  expect(compilato, 'l\'interruttore della carta non si trova nel file compilato').toMatch(/CARTA_ACCESA = false;/);
  writeFileSync(uscita, compilato.replace('CARTA_ACCESA = false;', 'CARTA_ACCESA = true;'));
  try {
    return (await import(/* @vite-ignore */ uscita)) as { default: unknown };
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}

const globale = globalThis as Record<string, unknown>;

const MARIA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it' };
const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FILONE = { id: 'p-filone', name: 'Filone', price: 15, quantity: 1, sellerId: PANE, storeName: 'Pane Quotidiano' };
const GRUPPI = {
  groups: [{ sellerId: PANE, storeName: 'Pane Quotidiano', storeLat: null, storeLng: null, items: [FILONE] }],
  orphans: [],
  stockIssues: [],
  variantIssues: [],
  prezziCambiati: [],
};
/** La bozza che la cassa ha salvato prima di mandare Maria all'accesso: aveva scelto «Adesso». */
const BOZZA = {
  form: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: '' },
  metodoPagamento: 'card',
  giorno: 'now',
  fasciaOggi: 'In giornata · 15:00–18:00',
  fasciaDomani: 'Domani · 15:00–18:30',
};
/** La risposta della veloce: la prova decide quando arriva e cosa dice. */
let rispondi: (esito: unknown) => void = () => undefined;
let domandeVeloce = 0;
const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (!url.includes('/api/consegna/veloce')) {
    return { ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null };
  }
  domandeVeloce += 1;
  const esito = await new Promise<unknown>((r) => {
    rispondi = r;
  });
  return { ok: true, json: async () => esito };
}) as unknown as typeof fetch;

const fusoDiPartenza = process.env.TZ;
let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  vi.useRealTimers();
  avvisi.errori.length = 0;
  domandeVeloce = 0;
  rispondi = () => undefined;
  delete globale.__DATI_QUERY__;
  delete globale.__UTENTE__;
  delete globale.__MUTAZIONI__;
  if (fusoDiPartenza === undefined) delete process.env.TZ;
  else process.env.TZ = fusoDiPartenza;
});
afterAll(() => {
  globalThis.fetch = reteDiPartenza;
});

async function assesta() {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe('con la carta e più negozi la cassa dice un giro solo', () => {
  it('bozza «card», pane da Pane Quotidiano e frutta da Frutta Bella: niente «ogni negozio fa consegnare il proprio»', async () => {
    const FRUTTA = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    const MELE = { id: 'p-mele', name: 'Mele', price: 12, quantity: 1, sellerId: FRUTTA, storeName: 'Frutta Bella' };
    const due = {
      ...GRUPPI,
      groups: [...GRUPPI.groups, { sellerId: FRUTTA, storeName: 'Frutta Bella', storeLat: null, storeLng: null, items: [MELE] }],
    };
    process.env.TZ = 'Europe/Rome';
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-29T17:00:00Z'));
    localStorage.setItem('cart', JSON.stringify(due.groups.flatMap((g) => g.items)));
    localStorage.setItem('mc_checkout_draft', JSON.stringify(BOZZA));
    globale.__UTENTE__ = MARIA;
    globale.__MUTAZIONI__ = [];
    globale.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
      const [chi, cosa] = o.queryKey;
      if (chi === 'checkout-groups') return String(cosa).includes(due.groups[0].items[0].id) ? due : undefined;
      if (chi === 'auth-user') return MARIA;
      if (chi === 'user-addresses') return [];
      return undefined;
    };
    const pagina = (await montaConCartaAccesa()).default as Parameters<typeof accendi>[0];
    schermo = accendi(pagina, {});
    await assesta();
    const testo = testoVisibile(schermo.radice);
    expect(testo, 'il riquadro dei negozi non c’è: la prova non misurerebbe niente').toMatch(/prodotti da 2 negozi diversi/);
    expect(testo, 'la carta non è attiva: la prova non misurerebbe il ramo carta').toMatch(/Un unico pagamento, 2 ordini separati/);
    expect(testo, 'la cassa promette un fattorino per negozio').not.toMatch(/Ogni rider consegna il proprio ordine/);
    expect(testo, 'la cassa promette una consegna per negozio').not.toMatch(/fa consegnare il proprio/);
    expect(testo, 'la cassa non dice il giro unico del carrello').toMatch(/il fattorino passa da tutti in un giro solo/);
  }, 30_000);
});
