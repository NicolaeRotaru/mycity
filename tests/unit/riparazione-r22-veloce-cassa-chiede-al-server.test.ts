/**
 * @vitest-environment jsdom
 */
/**
 * R22-016 — LA CASSA OFFRE «ADESSO» SOLO COL SÌ DEL SERVER, PROVATO SULLA PAGINA E NON SUL SORGENTE.
 *
 * `la-consegna-veloce-si-vende-solo-se-c-e-un-fattorino.test.ts`, nel caso «la cassa offre «Adesso»
 * solo con il sì del server», cerca quattro frasi nel testo di DeliverySlotPicker.tsx e di
 * app/checkout/page.tsx: un controllo che resta verde se la frase c'è ma non fa più quello che
 * dice, e diventa rosso se la si riscrive con le stesse regole. Qui la cassa si MONTA e si guarda
 * quello che vede il cliente:
 *   ① la cassa chiede la veloce al server per i negozi del carrello, e per nessun altro;
 *   ② finché il server non risponde, «Adesso» non si offre;
 *   ③ solo un sì la offre; un no, una risposta illeggibile o una rete caduta no;
 *   ④ anche col sì, fuori dalle ore della veloce (a Roma) non si offre.
 *
 * È una guardia, non una riparazione: passa sul codice di oggi.
 * ⚠️ Cosa NON prova: la rotta /api/consegna/veloce, che qui è finta (la sua regola la prova la prova
 * qui sopra, coi suoi casi montati sulla rotta vera).
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { act } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, info: () => undefined, error: () => undefined }),
}));

const globale = globalThis as Record<string, unknown>;

const MARIA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it' };
const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FRUTTA = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const FILONE = { id: 'p-filone', name: 'Filone', price: 15, quantity: 1, sellerId: PANE, storeName: 'Pane Quotidiano' };
const MELE = { id: 'p-mele', name: 'Mele', price: 12, quantity: 1, sellerId: FRUTTA, storeName: 'Frutta Bella' };
const gruppo = (sellerId: string, storeName: string, items: Array<typeof FILONE>) => ({ sellerId, storeName, storeLat: null, storeLng: null, items });
const SOLO_PANE = { groups: [gruppo(PANE, 'Pane Quotidiano', [FILONE])], orphans: [], stockIssues: [], variantIssues: [], prezziCambiati: [] };
const PANE_E_FRUTTA = { ...SOLO_PANE, groups: [...SOLO_PANE.groups, gruppo(FRUTTA, 'Frutta Bella', [MELE])] };
type Gruppi = typeof SOLO_PANE;

/** Le domande fatte alla veloce, e la risposta che la prova decide di dare. */
const domande: string[] = [];
let rispondi: (esito: { ok: boolean; corpo?: unknown } | Error) => void = () => undefined;
const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (!url.includes('/api/consegna/veloce')) {
    return { ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null };
  }
  domande.push(url);
  const esito = await new Promise<{ ok: boolean; corpo?: unknown } | Error>((r) => {
    rispondi = r;
  });
  if (esito instanceof Error) throw esito;
  return { ok: esito.ok, status: esito.ok ? 200 : 503, json: async () => esito.corpo };
}) as unknown as typeof fetch;

const fusoDiPartenza = process.env.TZ;
let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  vi.useRealTimers();
  domande.length = 0;
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

/** La cassa aperta da Maria (entrata, nessuna bozza) nell'istante detto, sul telefono col fuso detto. */
async function cassa(istanteUtc: string, gruppi: Gruppi = SOLO_PANE, fuso = 'Europe/Rome') {
  process.env.TZ = fuso;
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(istanteUtc));
  localStorage.setItem('cart', JSON.stringify(gruppi.groups.flatMap((g) => g.items)));
  globale.__UTENTE__ = MARIA;
  globale.__MUTAZIONI__ = [];
  globale.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [chi, cosa] = o.queryKey;
    if (chi === 'checkout-groups') return String(cosa).includes(gruppi.groups[0].items[0].id) ? gruppi : undefined;
    if (chi === 'auth-user') return MARIA;
    if (chi === 'user-addresses') return [];
    return undefined;
  };
  const pagina = (await monta('app/checkout/page.tsx')).default;
  schermo = accendi(pagina, {});
  await assesta();
  const s = schermo;
  const adesso = () => {
    const b = s.radice.querySelector<HTMLButtonElement>('button[aria-label^="Adesso,"]');
    expect(b, 'la tessera «Adesso» non si trova: la prova non misurerebbe niente').not.toBeNull();
    return b!;
  };
  return {
    adesso,
    /** «Adesso» si può scegliere: la tessera è accesa e, premuta, resta scelta. */
    siOffre: async () => {
      if (adesso().disabled) return false;
      await act(async () => {
        adesso().click();
      });
      await assesta();
      return adesso().getAttribute('aria-pressed') === 'true';
    },
    risponde: async (esito: { ok: boolean; corpo?: unknown } | Error) => {
      rispondi(esito);
      await assesta();
    },
  };
}

// Giovedì 29/10/2026 alle 10:00 di Roma (ora solare, UTC+1): dentro le ore della veloce.
const GIOVEDI_ALLE_10 = '2026-10-29T09:00:00Z';

describe('R22-016 · la cassa chiede la veloce al server, per i negozi del carrello', () => {
  it('un negozio: una domanda, con quel negozio', async () => {
    await cassa(GIOVEDI_ALLE_10);
    expect(domande, 'la cassa non ha chiesto la veloce al server').toHaveLength(1);
    const negozi = new URL(domande[0], 'https://mycity.test').searchParams.get('negozi');
    expect(negozi).toBe(PANE);
  }, 30_000);

  it('due negozi: la domanda li porta tutti e due', async () => {
    await cassa(GIOVEDI_ALLE_10, PANE_E_FRUTTA);
    expect(domande).toHaveLength(1);
    const negozi = new URL(domande[0], 'https://mycity.test').searchParams.get('negozi');
    expect(negozi?.split(',').sort()).toEqual([PANE, FRUTTA].sort());
  }, 30_000);
});

describe('R22-016 · «Adesso» si offre solo col sì del server', () => {
  it('finché il server non risponde, «Adesso» non si offre', async () => {
    const c = await cassa(GIOVEDI_ALLE_10);
    expect(c.adesso().disabled, 'la cassa offre «Adesso» prima del sì del server').toBe(true);
    expect(c.adesso().getAttribute('aria-label')).toMatch(/Sto controllando/);
  }, 30_000);

  it('col sì del server «Adesso» si offre e si sceglie', async () => {
    const c = await cassa(GIOVEDI_ALLE_10);
    await c.risponde({ ok: true, corpo: { possibile: true } });
    expect(await c.siOffre(), 'col sì del server «Adesso» deve potersi scegliere').toBe(true);
  }, 30_000);

  it('col no del server «Adesso» non si offre', async () => {
    const c = await cassa(GIOVEDI_ALLE_10);
    await c.risponde({ ok: true, corpo: { possibile: false, perche: 'Nessun fattorino è in servizio adesso.' } });
    expect(await c.siOffre(), 'col no del server la cassa offre lo stesso «Adesso»').toBe(false);
    expect(c.adesso().getAttribute('aria-pressed')).toBe('false');
  }, 30_000);

  it('una risposta che non è un sì chiaro vale no: illeggibile, rotta, o la rete che cade', async () => {
    for (const esito of [
      { ok: true, corpo: { possibile: 'sì' } },
      { ok: true, corpo: null },
      { ok: false, corpo: { possibile: true } },
      new Error('rete giù'),
    ]) {
      const c = await cassa(GIOVEDI_ALLE_10);
      await c.risponde(esito);
      expect(await c.siOffre(), `con ${esito instanceof Error ? 'la rete giù' : JSON.stringify(esito)} la cassa offre «Adesso»`).toBe(false);
      schermo?.smonta();
      schermo = null;
      domande.length = 0;
    }
  }, 60_000);

  it('anche col sì, alle 21:30 di Roma «Adesso» non si offre (e il telefono a Londra non cambia niente)', async () => {
    // Giovedì 29/10/2026 alle 21:30 di Roma = 20:30 a Londra.
    const c = await cassa('2026-10-29T20:30:00Z', SOLO_PANE, 'Europe/London');
    expect(new Date().getHours(), 'il fuso di Londra non ha preso: la prova non misurerebbe niente').toBe(20);
    await c.risponde({ ok: true, corpo: { possibile: true } });
    expect(await c.siOffre(), 'a Roma sono le 21:30: la cassa offre una veloce che la rotta rifiuterebbe').toBe(false);
  }, 30_000);
});
