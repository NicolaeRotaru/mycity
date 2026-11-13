/**
 * R14-017 — Un codice storto deve avere «codice non valido», non un guasto.
 *
 * Le tre rotte controllavano l'id con una regola larga (`[0-9a-f-]{36}`): 36
 * trattini, o 36 cifre senza trattini, passavano il controllo e arrivavano al
 * database, che li rifiuta («invalid input syntax for type uuid»). Per i
 * documenti del fattorino e per i dati d'identita' la rotta rispondeva 500,
 * per il riepilogo delle recensioni 404 «prodotto non trovato».
 *
 * Qui il database finto legge l'id come lo legge Postgres, e l'involucro di
 * accesso e' quello vero: un non amministratore deve restare fuori come prima.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const ADMIN_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALTRO_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const FATTORINO_ID = '11111111-2222-3333-4444-555555555555';
const PRODOTTO_ID = '22222222-3333-4444-5555-666666666666';

/** Due codici che la regola larga lasciava passare e che Postgres rifiuta. */
const STORTI = ['------------------------------------', '0123456789abcdef0123456789abcdef0123'];

/** Come Postgres legge un uuid (string_to_uuid): 16 coppie di cifre, un trattino ammesso ogni 4 cifre. */
function uuidPerPostgres(testo: string): boolean {
  let s = testo.trim();
  let graffa = false;
  if (s.startsWith('{')) { s = s.slice(1); graffa = true; }
  let i = 0;
  for (let b = 0; b < 16; b++) {
    if (!/^[0-9a-f]{2}/i.test(s.slice(i))) return false;
    i += 2;
    if (s[i] === '-' && b % 2 === 1 && b < 15) i++;
  }
  if (graffa) { if (s[i] !== '}') return false; i++; }
  return s.slice(i) === '';
}

const stato = vi.hoisted(() => ({
  utente: null as { id: string } | null,
  ruolo: 'admin',
  idRifiutati: [] as string[],
  firme: 0,
  verbale: 0,
  chiamateAi: 0,
}));

vi.mock('@/lib/audit', () => ({ writeAudit: async () => { stato.verbale++; } }));
vi.mock('@/lib/ai/run', async (importActual) => {
  const vero = await importActual<typeof import('@/lib/ai/run')>();
  return {
    ...vero,
    runMessage: async () => { stato.chiamateAi++; return { toolInput: { summary: 'ok' } }; },
  };
});

vi.mock('@/lib/supabase/server', () => {
  const risposta = (tabella: string, colonne: string, valore: string) => {
    if (!uuidPerPostgres(valore)) {
      stato.idRifiutati.push(valore);
      return { data: null, error: { code: '22P02', message: `invalid input syntax for type uuid: "${valore}"` } };
    }
    if (tabella === 'profiles' && colonne === 'id, role, is_approved') {
      return { data: { id: valore, role: stato.ruolo, is_approved: true }, error: null };
    }
    if (tabella === 'profiles' && colonne.includes('legal_fiscal_code')) {
      return { data: { id: valore, legal_fiscal_code: 'RSSMRA80A01G535X', business_vat_number: null }, error: null };
    }
    if (tabella === 'profiles') {
      return { data: { id: valore, role: 'rider', legal_birth_date: '2000-03-15', rider_license_url: `${valore}/patente.jpg` }, error: null };
    }
    if (tabella === 'products') {
      return { data: { id: valore, name: 'Maglietta', seller_id: ADMIN_ID }, error: null };
    }
    return { data: null, error: null };
  };
  const admin = {
    from: (tabella: string) => ({
      select: (colonne: string) => ({
        eq: (_colonna: string, valore: string) => ({
          single: async () => risposta(tabella, colonne, String(valore)),
          maybeSingle: async () => risposta(tabella, colonne, String(valore)),
          order: () => ({ limit: async () => ({ data: [{ rating: 5, comment: 'Ottimo' }], error: null }) }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => { stato.firme++; return { data: { signedUrl: `https://firmato/${path}` } }; },
      }),
    },
  };
  return {
    getCurrentUser: async () => stato.utente,
    getServerSupabase: async () => ({}),
    getAdminSupabase: () => admin,
  };
});

import { GET as documentiRider } from '@/app/api/kyc/documenti-rider/[id]/route';
import { GET as datiIdentita } from '@/app/api/admin/users/[id]/kyc/route';
import { POST as riepilogoRecensioni } from '@/app/api/ai/reviews-summary/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

type Rotta = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const apri = (rotta: unknown, percorso: string, id: string) =>
  (rotta as Rotta)(
    new NextRequest(`http://localhost${percorso}/${encodeURIComponent(id)}`, { headers: { 'x-forwarded-for': '1.2.3.4' } }),
    { params: Promise.resolve({ id }) },
  );
const documenti = (id: string) => apri(documentiRider, '/api/kyc/documenti-rider', id);
const identita = (id: string) => apri(datiIdentita, '/api/admin/users/kyc', id);
const riepilogo = (productId: string) =>
  (riepilogoRecensioni as unknown as (r: NextRequest) => Promise<Response>)(
    new NextRequest('http://localhost/api/ai/reviews-summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: JSON.stringify({ productId }),
    }),
  );

beforeEach(() => {
  __resetRateLimitBuckets();
  delete process.env.UPSTASH_REDIS_REST_URL;
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  stato.utente = { id: ADMIN_ID };
  stato.ruolo = 'admin';
  stato.idRifiutati = [];
  stato.firme = 0;
  stato.verbale = 0;
  stato.chiamateAi = 0;
});

describe('R14-017 — un codice storto riceve «codice non valido», non un guasto', () => {
  it.each(STORTI)('documenti del fattorino con %s: 400, e il database non lo vede', async (storto) => {
    const res = await documenti(storto);
    expect(res.status, 'un codice storto arrivava al database e la rotta rispondeva 500').toBe(400);
    expect(stato.idRifiutati).toEqual([]);
    expect(stato.firme).toBe(0);
    expect(stato.verbale).toBe(0);
  });

  it.each(STORTI)('dati d\'identita\' con %s: 400, e il database non lo vede', async (storto) => {
    const res = await identita(storto);
    expect(res.status, 'un codice storto arrivava al database e la rotta rispondeva 500').toBe(400);
    expect(stato.idRifiutati).toEqual([]);
    expect(stato.verbale).toBe(0);
  });

  it.each(STORTI)('riepilogo delle recensioni con %s: 400, non «prodotto non trovato»', async (storto) => {
    const res = await riepilogo(storto);
    expect(res.status, 'un codice storto arrivava al database e la rotta rispondeva 404').toBe(400);
    expect(stato.idRifiutati).toEqual([]);
    expect(stato.chiamateAi).toBe(0);
  });

  it('un codice buono passa come prima', async () => {
    expect((await documenti(FATTORINO_ID)).status).toBe(200);
    expect((await identita(FATTORINO_ID)).status).toBe(200);
    expect((await riepilogo(PRODOTTO_ID)).status).toBe(200);
    expect(stato.idRifiutati).toEqual([]);
  });
});

describe('R14-017 — chi puo\' aprire i documenti non cambia', () => {
  it.each(['rider', 'seller', 'buyer'])('un %s resta fuori dai documenti e dai dati d\'identita\'', async (ruolo) => {
    stato.utente = { id: ALTRO_ID };
    stato.ruolo = ruolo;
    for (const id of [FATTORINO_ID, STORTI[0]]) {
      expect((await documenti(id)).status).toBe(403);
      expect((await identita(id)).status).toBe(403);
    }
    expect(stato.firme).toBe(0);
    expect(stato.verbale).toBe(0);
  });

  it('chi non ha fatto l\'accesso riceve 401', async () => {
    stato.utente = null;
    expect((await documenti(FATTORINO_ID)).status).toBe(401);
    expect((await identita(STORTI[0])).status).toBe(401);
    expect(stato.firme).toBe(0);
  });

  it('un compratore resta fuori dal riepilogo delle recensioni', async () => {
    stato.utente = { id: ALTRO_ID };
    stato.ruolo = 'buyer';
    expect((await riepilogo(PRODOTTO_ID)).status).toBe(403);
    expect(stato.chiamateAi).toBe(0);
  });
});
