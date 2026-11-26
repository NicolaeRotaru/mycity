/**
 * La posizione del negozio poteva finire lontano da Piacenza e il server la salvava lo stesso.
 *
 * ① L'iscrizione (/api/seller/apply) accettava qualunque numero finito: un negozio messo nella
 *    Via Roma di Roma veniva approvato e ogni consegna ai suoi clienti era «fuori zona».
 * ② La ricerca (/api/geocode) restituiva solo lat e lng: il negozio non leggeva da nessuna parte
 *    in quale città era finito il suo indirizzo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const stato = vi.hoisted(() => ({ scritture: [] as Record<string, unknown>[] }));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'utente-1' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://esempio.test' } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true }),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: async () => 'scritto' }));
vi.mock('@/lib/agenzia/nuovo-cliente-n8n', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  cittaDallIndirizzo: () => null,
  inviaNuovaAttivitaAlFlusso: async () => undefined,
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      let scrive = false;
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.or = () => c;
      c.is = () => c;
      c.maybeSingle = async () => ({ data: { role: 'buyer', approval_status: 'pending' }, error: null });
      c.update = (v: Record<string, unknown>) => { scrive = true; stato.scritture.push(v); return c; };
      c.insert = async () => ({ error: null });
      (c as { then: unknown }).then = (ok: (v: unknown) => void) =>
        ok(scrive ? { data: [{ id: 'utente-1' }], error: null } : { data: null, error: null });
      return c;
    },
  }),
}));

const { POST: iscrivi } = await import('@/app/api/seller/apply/route');
const { POST: cercaIndirizzo } = await import('@/app/api/geocode/route');

const modulo = {
  contactPhone: '3331234567', legalFirstName: 'Mario', legalLastName: 'Rossi',
  legalFiscalCode: 'RSSMRA80E05G535X', legalBirthDate: '1980-05-05', legalResidenceAddr: 'Via Roma 1',
  legalResidenceCity: 'Piacenza', legalResidenceZip: '29121', businessLegalName: 'Forno Rossi',
  businessVatNumber: '01234567897', businessAddress: 'Via Roma 1', businessCity: 'Piacenza',
  businessZip: '29121', storeName: 'Forno Rossi', storeDescription: '', billingIban: '',
  storeLogo: null, storeMedia: [], storeAddress: 'Via Roma 12', storeLat: 45.05, storeLng: 9.69,
  acceptTos: true, acceptPrivacy: true, acceptAccuracy: true,
};
const invia = (corpo: unknown) =>
  (iscrivi as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/seller/apply', { method: 'POST', body: JSON.stringify(corpo) }),
  );

beforeEach(() => { stato.scritture = []; });
afterEach(() => vi.unstubAllGlobals());

describe('l\'iscrizione rifiuta una posizione fuori da Piacenza e dintorni', () => {
  for (const [dove, lat, lng] of [
    ['Roma', 41.9009, 12.4833],
    ['Milano', 45.4642, 9.19],
    ['il vecchio punto di partenza della mappa', 41.9028, 12.4964],
  ] as const) {
    it(`negozio a ${dove}: 400 e nessuna scrittura`, async () => {
      const r = await invia({ ...modulo, storeLat: lat, storeLng: lng });
      expect(r.status).toBe(400);
      expect(JSON.stringify(await r.json())).toContain('fuori da Piacenza');
      expect(stato.scritture).toHaveLength(0);
    });
  }

  it('negozio a Piacenza: passa e si scrive', async () => {
    const r = await invia(modulo);
    expect(r.status).toBe(200);
    expect(stato.scritture[0]).toMatchObject({ store_lat: 45.05, store_lng: 9.69 });
  });
});

describe('/api/geocode dice anche il nome del posto trovato', () => {
  it('restituisce lat, lng e nome', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify([{
        lat: '45.0497', lon: '9.6985',
        display_name: 'Via Roma, Centro Storico, Piacenza, Emilia-Romagna, Italia',
        address: { road: 'Via Roma', city: 'Piacenza', postcode: '29121' },
      }]), { status: 200 }));
    const res = await (cercaIndirizzo as unknown as (r: Request) => Promise<Response>)(
      new Request('http://localhost/api/geocode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: 'Via Roma 12, Italia' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lat: 45.0497, lng: 9.6985, nome: 'Via Roma, Centro Storico, Piacenza, Emilia-Romagna, Italia',
    });
  });
});
