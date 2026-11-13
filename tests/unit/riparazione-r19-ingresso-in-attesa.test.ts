import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R19-001 — IL PORTIERE NON CHIUDE FUORI CHI ASPETTA L'APPROVAZIONE.
 *
 * Il middleware vero, con NextRequest e un Supabase finto (stesso schema di
 * il-portiere-non-chiude-fuori-chi-aspetta-e-non-perde-il-rinnovo.test.ts).
 *
 * - Il negozio in attesa (o respinto: per il portiere è lo stesso «approvato
 *   no») arriva alla dashboard, dove il layout mostra l'attesa o il rifiuto,
 *   e non gira in tondo: né dalla dashboard, né dalla home, né dal catalogo.
 * - Il fattorino in attesa arriva al modulo dei documenti (/rider/onboarding)
 *   e al profilo; ogni altra pagina /rider lo porta lì, non alla home.
 * - Le pagine operative restano chiuse a tutti e due: prodotti, ordini, soldi
 *   per il negozio; consegne, guadagni, turni per il fattorino.
 */

type UtenteFinto = { id: string; email_confirmed_at: string | null } | null;
type RispostaUtente = { data: { user: UtenteFinto }; error?: unknown };

const getUser = vi.fn<() => Promise<RispostaUtente>>(async () => ({ data: { user: null } }));
const profiloLetto = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single: profiloLetto }) }) }),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

const NOME = 'sb-esempio-auth-token';
const CONFERMATO = '2026-01-01T00:00:00Z';

function cookieSessione(): string {
  const sessione = { access_token: 'a', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 };
  const b64 = btoa(JSON.stringify(sessione)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `base64-${b64}`;
}

function richiesta(percorso: string) {
  const req = new NextRequest(new URL(`https://mycity.test${percorso}`));
  req.cookies.set(NOME, cookieSessione());
  return req;
}

function conProfilo(role: string, is_approved: boolean) {
  getUser.mockResolvedValue({ data: { user: { id: 'u-1', email_confirmed_at: CONFERMATO } } });
  profiloLetto.mockResolvedValue({ data: { role, is_approved }, error: null });
}

async function dove(percorso: string): Promise<{ status: number; verso: string | null }> {
  const res = await middleware(richiesta(percorso));
  const loc = res.headers.get('location');
  return { status: res.status, verso: loc ? new URL(loc).pathname : null };
}

/**
 * Segue i rimandi come un browser. Se dopo sei passi non è ancora arrivato,
 * è un giro in tondo («troppi reindirizzamenti»).
 */
async function seguiFinoAllArrivo(partenza: string): Promise<{ arrivo: string; passi: string[] }> {
  const passi = [partenza];
  let qui = partenza;
  for (let i = 0; i < 6; i++) {
    const { status, verso } = await dove(qui);
    if (!verso) {
      expect(status).toBe(200);
      return { arrivo: qui, passi };
    }
    passi.push(verso);
    qui = verso;
  }
  throw new Error(`giro in tondo: ${passi.join(' -> ')}`);
}

beforeEach(() => {
  getUser.mockReset();
  profiloLetto.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
});

describe('il negozio in attesa arriva alla schermata d attesa, senza girare in tondo', () => {
  it('sulla dashboard entra: il layout mostra l attesa o il rifiuto', async () => {
    conProfilo('seller', false);
    expect(await dove('/seller/dashboard')).toEqual({ status: 200, verso: null });
  });

  it.each(['/', '/product/abc', '/store/forno', '/search', '/seller', '/seller/products'])(
    'da %s arriva alla dashboard in un passo',
    async (partenza) => {
      conProfilo('seller', false);
      const { arrivo, passi } = await seguiFinoAllArrivo(partenza);
      expect(arrivo).toBe('/seller/dashboard');
      expect(passi.length).toBeLessThanOrEqual(2);
    },
  );

  it.each(['/seller/products', '/seller/orders', '/seller/earnings', '/seller/products/nuovo'])(
    'le pagine operative %s restano chiuse',
    async (percorso) => {
      conProfilo('seller', false);
      expect(await dove(percorso)).toEqual({ status: 307, verso: '/seller/dashboard' });
    },
  );
});

describe('il fattorino in attesa arriva al modulo dei documenti', () => {
  it.each(['/rider/onboarding', '/rider/onboarding/', '/rider/profile'])('su %s entra', async (percorso) => {
    conProfilo('rider', false);
    expect(await dove(percorso)).toEqual({ status: 200, verso: null });
  });

  it('dalla sua area (dove lo porta l accesso) arriva al modulo, non alla home', async () => {
    conProfilo('rider', false);
    const { arrivo, passi } = await seguiFinoAllArrivo('/rider');
    expect(arrivo).toBe('/rider/onboarding');
    expect(passi.length).toBeLessThanOrEqual(2);
  });

  it.each([
    '/rider',
    '/rider/orders/ordine-1',
    '/rider/earnings',
    '/rider/availability',
    '/rider/history',
    '/rider/reviews',
    '/rider/onboarding-finto',
  ])('le consegne e il resto dell area (%s) restano chiusi', async (percorso) => {
    conProfilo('rider', false);
    expect(await dove(percorso)).toEqual({ status: 307, verso: '/rider/onboarding' });
  });
});

describe('chi non c entra resta fuori come prima', () => {
  it('il fattorino approvato entra dappertutto nella sua area', async () => {
    conProfilo('rider', true);
    expect(await dove('/rider')).toEqual({ status: 200, verso: null });
    expect(await dove('/rider/orders/ordine-1')).toEqual({ status: 200, verso: null });
    expect(await dove('/rider/onboarding')).toEqual({ status: 200, verso: null });
  });

  it.each([
    ['buyer', true, '/'],
    ['buyer', false, '/'],
    ['seller', false, '/seller/dashboard'],
    ['seller', true, '/seller/dashboard'],
  ])('un %s (approvato: %s) sul modulo del fattorino va a %s', async (role, approvato, verso) => {
    conProfilo(role, approvato);
    expect(await dove('/rider/onboarding')).toEqual({ status: 307, verso });
  });

  it('un cliente sul pannello del negozio torna alla home', async () => {
    conProfilo('buyer', true);
    expect(await dove('/seller/dashboard')).toEqual({ status: 307, verso: '/' });
  });

  it('senza sessione il modulo del fattorino chiede l accesso', async () => {
    const req = new NextRequest(new URL('https://mycity.test/rider/onboarding'));
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/sign-in');
  });
});
