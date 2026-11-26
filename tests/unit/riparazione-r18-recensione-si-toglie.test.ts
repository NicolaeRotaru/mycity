import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 26/11/2026 (R18-003) — UNA RECENSIONE SEGNALATA E ACCOLTA SI TOGLIE DAVVERO.
 *
 * I Termini promettono di togliere le recensioni non genuine, ma nessuna strada del sito ne toglieva
 * una: l'amministratore non ha DELETE su `reviews` e `store_reviews`, e PATCH /api/segnalazioni
 * rispondeva sempre «questo tipo di contenuto non si toglie da qui». Adesso l'esito di una segnalazione
 * accolta su una recensione prima la toglie (riga e foto), avvisa chi l'ha scritta, e solo dopo manda
 * «rimosso». La prova usa la rotta vera con una banca dati finta in memoria.
 */

type Riga = Record<string, unknown>;
const db: {
  segnalazione: Riga | null;
  reviews: Riga[];
  store_reviews: Riga[];
  tracce: Riga[];
  cancellaCade: boolean;
  avvisoCade: boolean;
} = { segnalazione: null, reviews: [], store_reviews: [], tracce: [], cancellaCade: false, avvisoCade: false };
const avvisi: Riga[] = [];
const fotoTolte: string[][] = [];
const comunicate: string[] = [];

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) => h({ user: { id: 'admin-1' }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/app/api/segnalazioni/esito/comunica', () => ({
  MOTIVAZIONE_MINIMA: 20,
  comunicaEsito: async (_a: unknown, id: string) => {
    comunicate.push(id);
    return { ok: true, segnalanteEmail: 'inviata', segnalanteNotifica: 'nessun_recapito', venditore: 'non_previsto' };
  },
}));

function tabella(nome: string) {
  const filtri: Array<[string, unknown]> = [];
  let cancella = false;
  const righe = (): Riga[] => {
    const tutte = nome === 'reviews' ? db.reviews : nome === 'store_reviews' ? db.store_reviews : nome === 'activity_events' ? db.tracce : [];
    return tutte.filter((r) => filtri.every(([c, v]) => r[c] === v));
  };
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => { filtri.push([c, v]); return q; },
    delete: () => { cancella = true; return q; },
    insert: async (r: Riga) => {
      if (nome !== 'notifications') throw new Error(`scrittura inattesa su ${nome}`);
      if (db.avvisoCade) return { error: { message: 'avviso caduto' } };
      avvisi.push(r);
      return { error: null };
    },
    maybeSingle: async () => {
      if (nome === 'segnalazioni') return { data: db.segnalazione, error: null };
      return { data: righe()[0] ?? null, error: null };
    },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (cancella) {
        if (db.cancellaCade) return Promise.resolve({ data: null, error: { message: 'cancellazione caduta' } }).then(ok, ko);
        const via = righe();
        if (nome === 'reviews') db.reviews = db.reviews.filter((r) => !via.includes(r));
        if (nome === 'store_reviews') db.store_reviews = db.store_reviews.filter((r) => !via.includes(r));
        return Promise.resolve({ data: via.map((r) => ({ id: r.id })), error: null }).then(ok, ko);
      }
      return Promise.resolve({ data: righe(), error: null }).then(ok, ko);
    },
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({}),
  getAdminSupabase: () => ({
    from: (t: string) => tabella(t),
    storage: { from: () => ({ remove: async (p: string[]) => { fotoTolte.push(p); return { error: null }; } }) },
  }),
}));

import { PATCH } from '@/app/api/segnalazioni/route';

const ID = '00000000-0000-4000-8000-000000000042';
const REC = '00000000-0000-4000-8000-0000000000aa';
const MOTIVO = 'La recensione non è genuina: chi la firma non ha mai comprato il prodotto.';
const FOTO = `https://progetto.supabase.co/storage/v1/object/public/reviews/autore-1/prod-1/foto%201.jpg`;

const chiama = async () => {
  const res = await (PATCH as unknown as (r: Request) => Promise<Response>)(new Request('http://x/api/segnalazioni', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ID }),
  }));
  return { stato: res.status, corpo: (await res.json().catch(() => null)) as Riga | null };
};

describe('R18-003 · la recensione accolta esce davvero, e chi l ha scritta lo sa', () => {
  beforeEach(() => {
    db.segnalazione = { stato: 'accolta', tipo: 'recensione', oggetto_id: REC, esito_motivato: MOTIVO };
    db.reviews = [];
    db.store_reviews = [];
    db.tracce = [];
    db.cancellaCade = false;
    db.avvisoCade = false;
    avvisi.length = 0;
    fotoTolte.length = 0;
    comunicate.length = 0;
  });

  it('recensione di un prodotto: tolta con la foto, autore avvisato con la motivazione, poi l esito', async () => {
    db.reviews = [{ id: REC, user_id: 'autore-1', photo_urls: [FOTO] }];
    const r = await chiama();
    expect(r.stato).toBe(200);
    expect(db.reviews).toEqual([]);
    expect(fotoTolte).toEqual([['autore-1/prod-1/foto 1.jpg']]);
    expect(avvisi).toHaveLength(1);
    expect(avvisi[0]).toMatchObject({ user_id: 'autore-1', category: 'system' });
    expect(String(avvisi[0].body)).toContain(MOTIVO);
    expect(r.corpo?.autore).toBe('inviata');
    expect(comunicate).toEqual([ID]);
  });

  it('recensione di un negozio (l altra tabella): tolta anche lei', async () => {
    db.store_reviews = [{ id: REC, user_id: 'autore-2', photo_urls: [] }];
    const r = await chiama();
    expect(r.stato).toBe(200);
    expect(db.store_reviews).toEqual([]);
    expect(avvisi[0]).toMatchObject({ user_id: 'autore-2' });
    expect(comunicate).toEqual([ID]);
  });

  it('se la cancellazione cade: 409, la recensione resta, nessun avviso e nessun esito', async () => {
    db.reviews = [{ id: REC, user_id: 'autore-1', photo_urls: [] }];
    db.cancellaCade = true;
    const r = await chiama();
    expect(r.stato).toBe(409);
    expect(db.reviews).toHaveLength(1);
    expect(avvisi).toEqual([]);
    expect(comunicate).toEqual([]);
  });

  it('senza motivazione non si toglie niente', async () => {
    db.segnalazione = { stato: 'accolta', tipo: 'recensione', oggetto_id: REC, esito_motivato: 'no' };
    db.reviews = [{ id: REC, user_id: 'autore-1', photo_urls: [] }];
    const r = await chiama();
    expect(r.stato).toBe(409);
    expect(db.reviews).toHaveLength(1);
    expect(comunicate).toEqual([]);
  });

  it('secondo invio dopo un esito non partito: già tolta e registrata, l esito riparte senza un secondo avviso', async () => {
    db.tracce = [{ id: 'ev-1', target_id: REC, action: 'delete' }];
    const r = await chiama();
    expect(r.stato).toBe(200);
    expect(avvisi).toEqual([]);
    expect(comunicate).toEqual([ID]);
  });

  it('non si trova e non risulta tolta: 409, niente «rimosso»', async () => {
    const r = await chiama();
    expect(r.stato).toBe(409);
    expect(comunicate).toEqual([]);
  });

  it('l avviso all autore che cade si vede: 502 e il canale nominato', async () => {
    db.reviews = [{ id: REC, user_id: 'autore-1', photo_urls: [] }];
    db.avvisoCade = true;
    const r = await chiama();
    expect(r.stato).toBe(502);
    expect(r.corpo?.autore).toBe('fallita');
  });

  it('respinta: la recensione resta dov è', async () => {
    db.segnalazione = { stato: 'respinta', tipo: 'recensione', oggetto_id: REC, esito_motivato: MOTIVO };
    db.reviews = [{ id: REC, user_id: 'autore-1', photo_urls: [] }];
    const r = await chiama();
    expect(r.stato).toBe(200);
    expect(db.reviews).toHaveLength(1);
    expect(avvisi).toEqual([]);
  });
});
