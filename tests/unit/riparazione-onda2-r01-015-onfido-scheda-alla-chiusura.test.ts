import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { databaseCheConosceLeColonne } from './aiuti/database-che-conosce-le-colonne';

/**
 * R01-015 (onda 2) — Con Onfido acceso le schede con nome, email, data di nascita, documento e selfie
 * restavano da Onfido: la rotta non passava il controllo di prima (ogni tentativo ne apriva una nuova),
 * la cancellazione dell'account non le toglieva, e se Onfido non diceva qual era la scheda di prima se
 * ne creava comunque un'altra.
 *
 * Qui: il fornitore vero (fetch finta), la rotta vera /api/kyc/start-check e `cancellaAccount` vero.
 */

const stato = vi.hoisted(() => ({
  fornitoreFinto: false,
  client: null as unknown,
}));
const startCheckFinto = vi.fn(async (..._a: unknown[]) => ({ ok: true, status: 'PENDING', providerCheckId: 'chk_nuovo' }));
const registro = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), spesa: vi.fn() }));

vi.mock('@/lib/logger', () => ({ logger: registro }));
vi.mock('@/lib/kyc/providers', async (orig) => {
  const vero = await orig<typeof import('@/lib/kyc/providers')>();
  return { ...vero, getKycProvider: () => (stato.fornitoreFinto ? { startCheck: startCheckFinto } : vero.getKycProvider()) };
});
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.client }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, gestore: (ctx: { user: { id: string; email: string } }) => Promise<Response>) => () =>
      gestore({ user: { id: 'negozio-1', email: 'anna@example.com' } }),
}));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => false, getStripe: () => ({}) }));

const { getKycProvider } = await import('@/lib/kyc/providers');
const { cancellaAccount } = await import('@/lib/account/cancellazione');

type Chiamata = { url: string; metodo: string };
let chiamate: Chiamata[] = [];
let rispostaCheck = 200;
let rispostaDelete = 204;

beforeEach(() => {
  stato.fornitoreFinto = false;
  startCheckFinto.mockClear();
  registro.warn.mockClear();
  vi.stubEnv('KYC_PROVIDER', 'onfido');
  vi.stubEnv('KYC_API_KEY', 'chiave-finta');
  chiamate = [];
  rispostaCheck = 200;
  rispostaDelete = 204;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    chiamate.push({ url, metodo });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://archivio.test/')) {
      return new Response(new Blob(['img']), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    if (url.endsWith('/checks/chk_vecchio') && metodo === 'GET') {
      return rispostaCheck === 200 ? json(200, { id: 'chk_vecchio', applicant_id: 'app_vecchia' }) : json(rispostaCheck, {});
    }
    if (url.endsWith('/applicants') && metodo === 'POST') return json(201, { id: 'app_nuova' });
    if (url.endsWith('/applicants/app_vecchia') && metodo === 'PUT') return json(200, { id: 'app_vecchia' });
    if (url.endsWith('/documents') || url.endsWith('/live_photos')) return json(201, { id: 'doc_1' });
    if (url.endsWith('/checks') && metodo === 'POST') return json(201, { id: 'chk_nuovo' });
    if (url.includes('/applicants/') && metodo === 'DELETE') return new Response(null, { status: rispostaDelete });
    return json(404, {});
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const percorsi = () =>
  chiamate.filter((c) => c.url.includes('onfido.com')).map((c) => `${c.metodo} ${c.url.replace(/^.*v3\.6/, '')}`);

describe('R01-015 · il fornitore non apre una seconda scheda quando non sa qual era la prima', () => {
  it('se Onfido non risponde sul controllo di prima, si ferma: nessuna scheda nuova', async () => {
    rispostaCheck = 503;
    const esito = await getKycProvider().startCheck(
      { userId: 'u1', firstName: 'Anna', lastName: 'Rossi', email: 'a@x.it', birthDate: '1990-01-01' },
      { idFrontUrl: 'https://archivio.test/f.jpg', selfieUrl: 'https://archivio.test/s.jpg' },
      'chk_vecchio',
    );
    expect(esito).toMatchObject({ ok: false });
    expect(percorsi()).toEqual(['GET /checks/chk_vecchio']);
  });

  it('controllo sparito da Onfido: «niente», ma resta la traccia con l\'id per cercare la scheda a mano', async () => {
    rispostaCheck = 404;
    const esito = await getKycProvider().cancellaScheda?.('chk_vecchio');
    expect(esito).toBe('niente');
    expect(registro.warn).toHaveBeenCalledWith(expect.stringMatching(/a mano/), expect.objectContaining({ checkId: 'chk_vecchio' }));
  });
});

describe('R01-015 · la rotta della verifica passa al fornitore il controllo di prima', () => {
  it('dopo un rifiuto, il nuovo tentativo porta l\'id del controllo rifiutato', async () => {
    stato.fornitoreFinto = true;
    const db = databaseCheConosceLeColonne({
      profiles: [{
        id: 'negozio-1',
        role: 'rider',
        legal_first_name: 'Anna',
        legal_last_name: 'Rossi',
        legal_fiscal_code: null,
        legal_birth_date: '1990-01-01',
        business_vat_number: null,
        kyc_id_doc_front_url: 'negozio-1/id_front-1.png',
        kyc_id_doc_back_url: null,
        kyc_selfie_url: 'negozio-1/selfie-1.png',
        rider_license_url: null,
        rider_insurance_url: null,
        rider_vehicle_type: 'BIKE',
        kyc_provider_check_id: 'chk_vecchio',
        kyc_provider_status: 'REJECTED',
      }],
    });
    stato.client = {
      from: (t: string) => {
        const b = db.from(t) as Record<string, unknown>;
        b.update = () => ({ eq: async () => ({ data: null, error: null }) });
        return b;
      },
      storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://firmato/${p}` }, error: null }) }) },
    };
    const { POST } = await import('@/app/api/kyc/start-check/route');
    const res = await (POST as unknown as (r: Request) => Promise<Response>)(
      new Request('http://localhost/api/kyc/start-check', { method: 'POST' }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(startCheckFinto).toHaveBeenCalledTimes(1);
    expect(startCheckFinto.mock.calls[0][2]).toBe('chk_vecchio');
  });
});

describe('R01-015 · alla cancellazione dell\'account la scheda su Onfido si toglie prima', () => {
  function fintoMondo() {
    const diario: string[] = [];
    const aggiornamentiProfilo: Record<string, unknown>[] = [];
    const admin = {
      // R08-006 (onda 2) — La funzione della cassa del fattorino (migrazione 999n) qui non c'è:
      // la guardia legge il registro, come prima della migrazione.
      rpc: async (nome: string) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${nome}` } }),
      from(tabella: string) {
        return {
          select(_c: string) {
            return {
              eq: async () => {
                if (tabella === 'profiles') return { data: [{ kyc_provider_check_id: 'chk_vecchio', stripe_customer_id: null }], error: null };
                return { data: [], error: null };
              },
            };
          },
          update(valori: Record<string, unknown>) {
            if (tabella === 'profiles') aggiornamentiProfilo.push(valori);
            return { eq: async () => ({ error: null }) };
          },
          delete() {
            return { ilike: async () => ({ error: null }) };
          },
        };
      },
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: { email: 'anna@example.com' } } }),
          deleteUser: async () => {
            diario.push('cancella-account');
            return { error: null };
          },
        },
      },
      storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ error: null }) }) },
    };
    return { admin, diario, aggiornamentiProfilo };
  }

  it('la scheda si toglie da Onfido, poi l\'account', async () => {
    const { admin, diario } = fintoMondo();
    const esito = await cancellaAccount(admin as never, '11111111-1111-4111-8111-111111111111');
    expect(esito.ok, JSON.stringify(esito)).toBe(true);
    expect(percorsi()).toEqual(['GET /checks/chk_vecchio', 'DELETE /applicants/app_vecchia']);
    expect(diario).toContain('cancella-account');
  });

  it('se Onfido non toglie la scheda, l\'account non si cancella e l\'id del controllo resta per riprovare', async () => {
    rispostaDelete = 500;
    const { admin, diario, aggiornamentiProfilo } = fintoMondo();
    const esito = await cancellaAccount(admin as never, '11111111-1111-4111-8111-111111111111');
    expect(esito.ok).toBe(false);
    expect(diario).not.toContain('cancella-account');
    const azzeramentoKyc = aggiornamentiProfilo.find((v) => 'legal_fiscal_code' in v);
    expect(azzeramentoKyc, 'i dati di verifica si azzerano comunque').toBeTruthy();
    expect(azzeramentoKyc).not.toHaveProperty('kyc_provider_check_id');
  });
});
