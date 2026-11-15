/**
 * @vitest-environment jsdom
 */
/**
 * R22-016 — L'INVIO RILEGGE L'ORA DI ROMA, PROVATO PREMENDO «ORDINA» E NON LEGGENDO IL SORGENTE.
 *
 * `l-ordine-con-un-appuntamento-gia-passato.test.ts`, nel caso «la fascia si ricontrolla anche AL
 * MOMENTO di ordinare», cerca nel testo di app/checkout/page.tsx tre frasi dopo `const handleSubmit`
 * (riga 330: `ora: romeNow().getHours()`). Un controllo così resta verde se le frasi ci sono ma
 * l'invio non le usa, e non dice se l'ordine si ferma davvero. Qui la cassa si MONTA, l'orologio va
 * avanti senza che la pagina ridisegni (come chi apre la cassa e preme «Ordina» dieci minuti dopo),
 * e si guarda se l'ordine parte:
 *   ① «Oggi · 19:30–21:00» scelta alle 19:55: alle 19:58 l'ordine parte, alle 20:05 no, e lo dice;
 *   ② «Adesso» col sì del server, telefono a Londra: alle 20:58 di Roma parte, alle 21:05 di Roma
 *      (le 20:05 sul telefono) no — l'ora che conta è quella di Roma, come nelle rotte.
 *
 * È una guardia, non una riparazione: passa sul codice di oggi.
 * ⚠️ Cosa NON prova: le rotte, che rifiutano le stesse fasce col loro 409 (lì l'ordine qui è finto).
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { act } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

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
const FORM = { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: '' };

let rispondi: (esito: unknown) => void = () => undefined;
const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (!url.includes('/api/consegna/veloce')) {
    return { ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null };
  }
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

/**
 * La cassa di Maria (entrata) aperta nell'istante detto, sul telefono col fuso detto, con la scelta
 * della bozza già rimessa. Il server della veloce risponde quello che gli si dice.
 */
async function cassa(a: { fuso: string; istanteUtc: string; bozza: Record<string, unknown>; veloce: unknown }) {
  process.env.TZ = a.fuso;
  // Si finge l'intervallo: il selettore e la cassa NON ridisegnano da soli col passare del tempo.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(a.istanteUtc));
  localStorage.setItem('cart', JSON.stringify(GRUPPI.groups.flatMap((g) => g.items)));
  localStorage.setItem('mc_checkout_draft', JSON.stringify({ form: FORM, metodoPagamento: 'cod', ...a.bozza }));
  globale.__UTENTE__ = MARIA;
  globale.__MUTAZIONI__ = [];
  globale.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [chi, cosa] = o.queryKey;
    if (chi === 'checkout-groups') return String(cosa).includes(FILONE.id) ? GRUPPI : undefined;
    if (chi === 'auth-user') return MARIA;
    if (chi === 'user-addresses') return [];
    return undefined;
  };
  const pagina = (await monta('app/checkout/page.tsx')).default;
  schermo = accendi(pagina, {});
  await assesta();
  rispondi(a.veloce);
  await assesta();
  const s = schermo;
  return {
    tessera: (nome: string) => s.radice.querySelector<HTMLButtonElement>(`button[aria-label^="${nome},"]`),
    fascia: () => s.radice.querySelector<HTMLInputElement>('input[name="deliverySlot"]:checked')?.value ?? null,
    /** L'orologio va avanti fino all'istante detto, senza che la pagina ridisegni; poi si preme «Ordina». */
    ordinaAlle: async (istanteUtc: string) => {
      vi.setSystemTime(new Date(istanteUtc));
      const modulo = s.radice.querySelector('form#checkout-form');
      expect(modulo, 'il modulo della cassa non si trova: la prova non misurerebbe niente').not.toBeNull();
      await act(async () => {
        modulo!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      });
      await assesta();
      return (globale.__MUTAZIONI__ as unknown[]).length;
    },
  };
}

// Giovedì 29/10/2026, ora solare (Roma = UTC+1, Londra = UTC).
const ALLE_19_55_DI_ROMA = '2026-10-29T18:55:00Z';
const ALLE_19_58_DI_ROMA = '2026-10-29T18:58:00Z';
const ALLE_20_05_DI_ROMA = '2026-10-29T19:05:00Z';
const ALLE_20_55_DI_ROMA = '2026-10-29T19:55:00Z';
const ALLE_20_58_DI_ROMA = '2026-10-29T19:58:00Z';
const ALLE_21_05_DI_ROMA = '2026-10-29T20:05:00Z';

describe('R22-016 · la fascia di oggi si ricontrolla quando si preme «Ordina»', () => {
  const bozzaOggi = { giorno: 'today', fasciaOggi: 'Oggi · 19:30–21:00', sceltaIl: Date.parse(ALLE_19_55_DI_ROMA) };
  const apri = () => cassa({ fuso: 'Europe/Rome', istanteUtc: ALLE_19_55_DI_ROMA, bozza: bozzaOggi, veloce: { possibile: false } });

  it('scelta alle 19:55 e confermata alle 19:58: l’ordine parte', async () => {
    const c = await apri();
    expect(c.tessera('Oggi')?.getAttribute('aria-pressed'), 'la bozza non ha rimesso «Oggi»: la prova non misurerebbe niente').toBe('true');
    expect(c.fascia()).toBe('Oggi · 19:30–21:00');
    expect(await c.ordinaAlle(ALLE_19_58_DI_ROMA), 'alle 19:58 la fascia si può ancora: l’ordine deve partire').toBe(1);
    expect(avvisi.errori).toEqual([]);
  }, 30_000);

  it('scelta alle 19:55 e confermata alle 20:05, senza che la pagina ridisegni: l’ordine non parte, e lo dice', async () => {
    const c = await apri();
    expect(c.fascia()).toBe('Oggi · 19:30–21:00');
    expect(await c.ordinaAlle(ALLE_20_05_DI_ROMA), 'alle 20:05 la fascia 19:30–21:00 non si può più: l’ordine è partito').toBe(0);
    expect(avvisi.errori.join(' · '), 'il cliente non sa perché l’ordine non parte').toMatch(/Per oggi non ci sono più fasce/);
  }, 30_000);
});

describe('R22-016 · «Adesso» si ricontrolla all’invio con l’ora di Roma, non con quella del telefono', () => {
  const apriALondra = () =>
    cassa({ fuso: 'Europe/London', istanteUtc: ALLE_20_55_DI_ROMA, bozza: { giorno: 'now' }, veloce: { possibile: true } });

  it('telefono a Londra, a Roma le 20:58: l’ordine con la veloce parte', async () => {
    const c = await apriALondra();
    expect(new Date().getHours(), 'il fuso di Londra non ha preso: la prova non misurerebbe niente').toBe(19);
    expect(c.tessera('Adesso')?.getAttribute('aria-pressed'), '«Adesso» non è scelta: la prova non misurerebbe niente').toBe('true');
    expect(await c.ordinaAlle(ALLE_20_58_DI_ROMA)).toBe(1);
    expect(avvisi.errori).toEqual([]);
  }, 30_000);

  it('telefono a Londra alle 20:05, a Roma le 21:05: l’ordine con la veloce non parte, e lo dice', async () => {
    const c = await apriALondra();
    expect(c.tessera('Adesso')?.getAttribute('aria-pressed')).toBe('true');
    const ordini = await c.ordinaAlle(ALLE_21_05_DI_ROMA);
    expect(new Date().getHours(), 'sul telefono sono le 20: è il caso giusto').toBe(20);
    expect(ordini, 'a Roma sono le 21:05: la veloce non c’è più, ma l’ordine è partito (l’invio ha letto l’ora del telefono, o non l’ha riletta)').toBe(0);
    expect(avvisi.errori.join(' · ')).toMatch(/consegna immediata non è disponibile/);
  }, 30_000);
});
