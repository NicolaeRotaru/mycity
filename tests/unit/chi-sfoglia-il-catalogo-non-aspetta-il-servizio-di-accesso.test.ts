import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/8/2026 (R072) — OGNI PAGINA DEL CATALOGO CHIEDEVA A SUPABASE CHI SEI.
 *
 * `supabase.auth.getUser()` non legge un cookie: fa una chiamata di rete al
 * servizio di autenticazione. Nel middleware partiva su ogni pagina del
 * marketplace — home, prodotto, negozio, carrello, ricerca, cassa — per
 * chiunque avesse fatto l'accesso, PRIMA ancora di iniziare a disegnare la
 * pagina. Il visitatore anonimo usciva prima (086), il cliente connesso no.
 *
 * Eppure l'unica cosa che serviva su quelle pagine era sapere se chi guarda e'
 * un venditore: quel dato sta gia' in un cookie firmato da noi, httpOnly, che
 * dura dieci minuti — e si leggeva DOPO la chiamata di rete, cioe' quando il
 * costo era gia' stato pagato.
 *
 * Cosa costava: un giro Vercel→Supabase davanti al primo byte di ogni click di
 * chi sta comprando, cassa compresa.
 *
 * IL PERNO DELLA FIDUCIA, DICHIARATO. Il cookie del ruolo portava dentro l'id
 * della persona e si controllava contro quello restituito da `getUser()`:
 * leggerlo prima vuol dire non avere piu' quel confronto. Al suo posto il
 * cookie porta adesso l'IMPRONTA DELLA SESSIONE — un'impronta dei cookie
 * `sb-…-auth-token`, che sono la credenziale vera. Sessione diversa (altra
 * persona, o gettone rinnovato) = impronta diversa = cookie che non vale piu',
 * e si torna a chiedere. Non si crede a niente che non sia firmato da noi e
 * legato a questa sessione.
 */

const createServerClient = vi.fn();
type UtenteFinto = { id: string; email_confirmed_at: string | null } | null;
const getUser = vi.fn<() => Promise<{ data: { user: UtenteFinto } }>>(
  async () => ({ data: { user: null } }),
);
const profiloLetto = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => {
    createServerClient(...args);
    return {
      auth: { getUser },
      from: () => ({ select: () => ({ eq: () => ({ single: profiloLetto }) }) }),
    };
  },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

function richiesta(percorso: string, cookie?: Record<string, string>) {
  const req = new NextRequest(new URL(`https://mycity.test${percorso}`));
  for (const [k, v] of Object.entries(cookie ?? {})) req.cookies.set(k, v);
  return req;
}

/** Il primo giro: chiede a Supabase e si porta a casa il cookie del ruolo. */
async function primoGiro(percorso: string, gettone: string) {
  const res = await middleware(richiesta(percorso, { 'sb-esempio-auth-token': gettone }));
  return res.cookies.get('mc_ruolo')?.value ?? '';
}

beforeEach(() => {
  createServerClient.mockClear();
  getUser.mockClear();
  profiloLetto.mockClear();
  getUser.mockResolvedValue({
    data: { user: { id: 'u-1', email_confirmed_at: '2026-01-01T00:00:00Z' } },
  });
  profiloLetto.mockResolvedValue({ data: { role: 'buyer', is_approved: true } });
});

describe('il cliente connesso che sfoglia il catalogo', () => {
  it('alla seconda pagina non fa piu nessuna chiamata al servizio di accesso', async () => {
    const ruolo = await primoGiro('/product/abc', 'g1');
    expect(ruolo, 'il ruolo non e finito nel cookie firmato').toBeTruthy();
    expect(getUser).toHaveBeenCalledTimes(1);

    await middleware(richiesta('/', { 'sb-esempio-auth-token': 'g1', mc_ruolo: ruolo }));
    await middleware(richiesta('/cart', { 'sb-esempio-auth-token': 'g1', mc_ruolo: ruolo }));
    await middleware(richiesta('/search?q=pane', { 'sb-esempio-auth-token': 'g1', mc_ruolo: ruolo }));

    expect(
      getUser,
      'il servizio di autenticazione viene ancora interrogato a ogni pagina del catalogo',
    ).toHaveBeenCalledTimes(1);
  });

  it('le pagine del catalogo restano aperte: nessun rimando', async () => {
    const ruolo = await primoGiro('/product/abc', 'g1');
    const res = await middleware(richiesta('/checkout', { 'sb-esempio-auth-token': 'g1', mc_ruolo: ruolo }));
    expect(res.status, 'la scorciatoia ha rimandato altrove chi stava comprando').toBe(200);
  });
});

describe('la scorciatoia non si applica dove servirebbe la verita', () => {
  it('sul venditore il controllo vero si fa comunque: e il suo, il cancello', async () => {
    profiloLetto.mockResolvedValue({ data: { role: 'seller', is_approved: true } });
    const ruolo = await primoGiro('/product/abc', 'g1');

    getUser.mockClear();
    const res = await middleware(richiesta('/product/abc', { 'sb-esempio-auth-token': 'g1', mc_ruolo: ruolo }));

    expect(getUser, 'un venditore e passato senza che nessuno lo verificasse').toHaveBeenCalled();
    expect(res.status, 'il venditore non e stato riportato al suo pannello').toBe(307);
  });

  it('nelle aree protette si chiede sempre chi sei', async () => {
    const ruolo = await primoGiro('/product/abc', 'g1');
    getUser.mockClear();

    await middleware(richiesta('/profile', { 'sb-esempio-auth-token': 'g1', mc_ruolo: ruolo }));
    expect(getUser, '/profile si e fidato di un cookie vecchio di dieci minuti').toHaveBeenCalled();
  });

  it('un cookie del ruolo nato in un altra sessione non vale', async () => {
    const ruolo = await primoGiro('/product/abc', 'g1');
    getUser.mockClear();
    profiloLetto.mockClear();

    // Stesso browser, sessione diversa: e' entrata un'altra persona.
    await middleware(richiesta('/product/abc', { 'sb-esempio-auth-token': 'g2', mc_ruolo: ruolo }));

    expect(
      getUser,
      'il cookie di una sessione finita e stato riusato per la sessione dopo',
    ).toHaveBeenCalledTimes(1);
    expect(profiloLetto).toHaveBeenCalledTimes(1);
  });

  it('chi non ha ancora confermato l email viene mandato a confermarla, non lasciato passare', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-1', email_confirmed_at: null } } });
    const primo = await middleware(richiesta('/product/abc', { 'sb-esempio-auth-token': 'g1' }));
    expect(primo.status).toBe(307);
    expect(primo.headers.get('location')).toContain('/auth/verify-email');

    // E nemmeno un cookie del ruolo scritto prima della conferma puo' scavalcare
    // quel cancello.
    const ruolo = primo.cookies.get('mc_ruolo')?.value;
    if (ruolo) {
      getUser.mockClear();
      const dopo = await middleware(richiesta('/product/abc', {
        'sb-esempio-auth-token': 'g1',
        mc_ruolo: ruolo,
      }));
      expect(dopo.headers.get('location')).toContain('/auth/verify-email');
    }
  });
});
