/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 29/10/2026 — «Consegna in 30-60 min» ovunque, e in produzione nessun fattorino approvato.
 *
 * La veloce («Adesso») si vende solo se si può mantenere: dalle 8 alle 21 a Piacenza, negozi
 * aperti adesso, almeno un fattorino approvato con l'interruttore acceso. Le due rotte rifiutano
 * con un 409, la cassa non offre «Adesso», il carrello non scrive minuti. Se una lettura cade,
 * niente veloce. Al lancio il fattorino è Nicola: interruttore acceso → c'è, spento → no.
 */

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
        select: (_c: string, o?: { head?: boolean }) => {
          soloConteggio = !!o?.head;
          return q;
        },
        eq: (c: string, v: unknown) => {
          filtri.push([c, v]);
          return q;
        },
        in: (_c: string, v: string[]) => {
          inId = v;
          return q;
        },
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

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, info: () => undefined, error: () => undefined }),
}));

// R11-005 — La cassa si monta per davvero (il montaggio e il finto sono quelli di
// riparazione-r22-veloce-cassa-chiede-al-server): la guardia sulla cassa guarda quello che vede il cliente.
const globale = globalThis as Record<string, unknown>;
const MARIA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it' };
const NEGOZIO_DEL_CARRELLO = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FILONE = { id: 'p-filone', name: 'Filone', price: 15, quantity: 1, sellerId: NEGOZIO_DEL_CARRELLO, storeName: 'Pane Quotidiano' };
const GRUPPI = {
  groups: [{ sellerId: NEGOZIO_DEL_CARRELLO, storeName: 'Pane Quotidiano', storeLat: null, storeLng: null, items: [FILONE] }],
  orphans: [],
  stockIssues: [],
  variantIssues: [],
  prezziCambiati: [],
};
const domandeAllaVeloce: string[] = [];
let rispondiAllaVeloce: (esito: { ok: boolean; corpo?: unknown } | Error) => void = () => undefined;
const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (!url.includes('/api/consegna/veloce')) {
    return { ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null };
  }
  domandeAllaVeloce.push(url);
  const esito = await new Promise<{ ok: boolean; corpo?: unknown } | Error>((r) => {
    rispondiAllaVeloce = r;
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
  domandeAllaVeloce.length = 0;
  rispondiAllaVeloce = () => undefined;
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

/** La cassa aperta da Maria (entrata, nessuna bozza) giovedì 29/10/2026 alle 10:00 di Roma, ora solare. */
async function cassaAlleDieci() {
  process.env.TZ = 'Europe/Rome';
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-10-29T09:00:00Z'));
  localStorage.setItem('cart', JSON.stringify(GRUPPI.groups.flatMap((g) => g.items)));
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
    risponde: async (esito: { ok: boolean; corpo?: unknown }) => {
      rispondiAllaVeloce(esito);
      await assesta();
    },
  };
}

import { contaFattoriniOnline, rigaQuandoArrivaNelCarrello, veloceSiPuo } from '@/lib/ordini/consegna-veloce';
import { GET } from '@/app/api/consegna/veloce/route';

const FORNAIO = '11111111-1111-4111-8111-111111111111';
const SEMPRE_APERTO = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => [k, [['00:00', '23:59']]]),
);
const SEMPRE_CHIUSO = { mon: [['05:00', '05:01']] };
const fornaio = (orari: unknown) => ({ id: FORNAIO, role: 'seller', is_approved: true, store_name: 'Il fornaio', store_hours: orari });
const nicola = (online: boolean, approvato = true) => ({
  id: 'r1',
  role: 'rider',
  is_approved: approvato,
  rider_is_online: online,
});

// Giovedì 29/10/2026: alle 10:00 e alle 21:30 di Piacenza (ora solare, UTC+1).
const ALLE_DIECI = new Date('2026-10-29T09:00:00Z');
const ALLE_21_E_30 = new Date('2026-10-29T20:30:00Z');

async function chiedi(adesso: Date) {
  vi.useFakeTimers();
  vi.setSystemTime(adesso);
  const r = await GET(new Request(`https://mycity.test/api/consegna/veloce?negozi=${FORNAIO}`));
  vi.useRealTimers();
  return (await r.json()) as { possibile: boolean; perche?: string };
}

afterEach(() => {
  stato.profili = [];
  stato.rotto = false;
  vi.useRealTimers();
});

describe('la consegna veloce si vende solo se c’è un fattorino online', () => {
  it('zero fattorini online: niente veloce', async () => {
    stato.profili = [fornaio(SEMPRE_APERTO)];
    expect((await chiedi(ALLE_DIECI)).possibile).toBe(false);
  });

  it('un fattorino offline (o non approvato): niente veloce', async () => {
    stato.profili = [fornaio(SEMPRE_APERTO), nicola(false)];
    expect((await chiedi(ALLE_DIECI)).possibile).toBe(false);
    stato.profili = [fornaio(SEMPRE_APERTO), nicola(true, false)];
    expect((await chiedi(ALLE_DIECI)).possibile).toBe(false);
  });

  it('un fattorino online, negozio aperto, alle 10: la veloce c’è', async () => {
    stato.profili = [fornaio(SEMPRE_APERTO), nicola(true)];
    expect((await chiedi(ALLE_DIECI)).possibile).toBe(true);
  });

  it('alle 21:30 no, anche col fattorino online', async () => {
    stato.profili = [fornaio(SEMPRE_APERTO), nicola(true)];
    const esito = await chiedi(ALLE_21_E_30);
    expect(esito.possibile).toBe(false);
    expect(esito.perche).toContain('fascia');
  });

  it('negozio chiuso adesso: no', async () => {
    stato.profili = [fornaio(SEMPRE_CHIUSO), nicola(true)];
    expect((await chiedi(ALLE_DIECI)).possibile).toBe(false);
  });

  it('se la lettura cade non si promette alla cieca', async () => {
    stato.profili = [fornaio(SEMPRE_APERTO), nicola(true)];
    stato.rotto = true;
    expect((await chiedi(ALLE_DIECI)).possibile).toBe(false);
    expect(await contaFattoriniOnline(dbFinto() as never)).toBeNull();
    expect(veloceSiPuo({ adesso: new Date(2026, 9, 29, 10), negozi: null, fattoriniOnline: 1 }).possibile).toBe(false);
  });

  it('le due rotte rifiutano «Adesso» con un 409 dalla stessa decisione', () => {
    for (const rotta of ['app/api/orders/cod/route.ts', 'app/api/stripe/checkout/route.ts']) {
      const src = readFileSync(rotta, 'utf8');
      const blocco = src.slice(src.indexOf('if (consegnaVeloce) {'), src.indexOf('if (consegnaVeloce) {') + 600);
      expect(blocco, rotta).toContain('veloceSiPuo({');
      expect(blocco, rotta).toContain('fattoriniOnline: await contaFattoriniOnline(admin)');
      expect(blocco, rotta).toContain('ApiErrors.conflict(veloce.perche)');
    }
  });

  it('la cassa offre «Adesso» solo con il sì del server', async () => {
    // R11-005 — Prima erano quattro frasi cercate nel testo di DeliverySlotPicker.tsx e di
    // app/checkout/page.tsx. Adesso la cassa si monta e si guarda quello che vede il cliente.
    // ① la cassa chiede la veloce al server, una volta, per il negozio del carrello
    const prima = await cassaAlleDieci();
    expect(domandeAllaVeloce, 'la cassa non ha chiesto la veloce al server, o l\'ha chiesta più volte').toHaveLength(1);
    expect(new URL(domandeAllaVeloce[0], 'https://mycity.test').searchParams.get('negozi')).toBe(NEGOZIO_DEL_CARRELLO);
    // ② finché il server non risponde, «Adesso» non si offre
    expect(prima.adesso().disabled, 'la cassa offre «Adesso» prima del sì del server').toBe(true);
    // ③ col sì del server «Adesso» si sceglie
    await prima.risponde({ ok: true, corpo: { possibile: true } });
    expect(await prima.siOffre(), 'col sì del server «Adesso» deve potersi scegliere').toBe(true);
    schermo?.smonta();
    schermo = null;
    domandeAllaVeloce.length = 0;
    // ④ col no del server no
    const seconda = await cassaAlleDieci();
    await seconda.risponde({ ok: true, corpo: { possibile: false, perche: 'Nessun fattorino è in servizio adesso.' } });
    expect(await seconda.siOffre(), 'col no del server la cassa offre lo stesso «Adesso»').toBe(false);
  }, 60_000);
});

describe('il carrello non scrive «30-60 min» se la veloce non si può', () => {
  it('scrive i minuti solo col sì del server e dentro le 8-21', () => {
    expect(rigaQuandoArrivaNelCarrello(10, true)).toMatch(/min/);
    expect(rigaQuandoArrivaNelCarrello(10, false)).not.toMatch(/min/);
    expect(rigaQuandoArrivaNelCarrello(21, true)).not.toMatch(/min/);
    expect(rigaQuandoArrivaNelCarrello(10, null)).toBeNull();
    expect(rigaQuandoArrivaNelCarrello(null, true)).toBeNull();
  });

  it('il carrello chiede al server, non solo all’orologio', () => {
    const carrello = readFileSync('app/cart/page.tsx', 'utf8');
    expect(carrello).toContain('/api/consegna/veloce?negozi=');
    expect(carrello).toContain('quandoArrivaScrittoNelCarrello(oraDiAdesso, veloceSiPuoAdesso)');
    expect(carrello).not.toMatch(/if \(expressSiPuo\(ora\)\) return `Consegna in/);
  });
});
