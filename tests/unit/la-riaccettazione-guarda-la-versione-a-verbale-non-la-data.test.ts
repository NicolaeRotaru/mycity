import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 1/11/2026 (ondata 6) — «HA ACCETTATO I TESTI IN VIGORE» È UNA REGOLA SOLA.
 *
 * Fatto legale.termini-riaccettazione (Nicola, 31/10): quando i Termini
 * cambiano, chi è già iscritto li riaccetta prima di ordinare. I Termini in
 * vigore sono i 3.0.
 *
 * Fino a oggi bastava la data nel profilo (`tos_accepted_at`):
 *  - Maria (1/9, riga «privacy-2.0+terms-2.0») al primo accesso entrava senza
 *    che nessuno le chiedesse i 3.0, e il verbale le rispondeva «già accettata»;
 *  - Lucia (data nel profilo, nessuna riga: iscritta prima del verbale) pagava
 *    sotto i 3.0, perché la cassa trattava «nessuna riga» come «in regola»;
 *  - un negozio già approvato non riaccettava mai: l'area del negozio non
 *    guardava niente.
 *
 * Ora vale una regola sola, per le porte d'ingresso, la cassa e l'area del
 * negozio: ha accettato i testi in vigore chi ha come ultima riga del verbale
 * la versione in vigore. Una data senza riga, o una riga senza versione, no.
 */

const IN_VIGORE = 'privacy-2.0+terms-3.0';
const VECCHIA = 'privacy-2.0+terms-2.0';

type Riga = { versione_testo: string | null } | null;
const stato: { profilo: Record<string, unknown> | null; riga: Riga } = { profilo: null, riga: null };
const inseriti: Array<{ tabella: string; riga: Record<string, unknown> }> = [];

function catena(tabella: string) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'update']) q[m] = () => q;
  const dato = () => (tabella === 'consent_log' ? stato.riga : stato.profilo);
  q.single = async () => ({ data: dato(), error: null });
  q.maybeSingle = async () => ({ data: dato(), error: null });
  q.insert = (riga: Record<string, unknown>) => {
    inseriti.push({ tabella, riga });
    return Promise.resolve({ error: null });
  };
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(ok, ko);
  return q;
}
const db = { from: (t: string) => catena(t) };

const UTENTE = { id: 'persona', email_confirmed_at: '2026-09-01T10:00:00Z' };

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: UTENTE }, error: null }) },
    from: (t: string) => catena(t),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const { vaChiestaSenzaTrattenere, verbalizzaAccettazione, versioneAccettata } = await import(
  '@/lib/auth/accettazione-testi'
);
const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

const CLIENTE = { role: 'buyer', is_approved: true, tos_accepted_at: '2026-09-01T10:00:00Z' };
const NEGOZIO = { role: 'seller', is_approved: true, tos_accepted_at: '2026-09-01T10:00:00Z' };

function apre(percorso: string) {
  const req = new NextRequest(new URL(`https://mycity.test${percorso}`));
  req.cookies.set('sb-esempio-auth-token', 'sessione-aperta');
  return req;
}
async function doveLaManda(percorso: string): Promise<string | null> {
  const dove = (await middleware(apre(percorso))).headers.get('location');
  if (!dove) return null;
  const u = new URL(dove);
  return `${u.pathname}?next=${u.searchParams.get('next')}`;
}

beforeEach(() => {
  stato.profilo = { ...CLIENTE };
  stato.riga = null;
  inseriti.length = 0;
});

describe('Le porte d ingresso (ritorno dal link, conferma, accesso con la password)', () => {
  it('Maria (data 1/9, riga dei Termini 2.0) al primo accesso viene mandata a riaccettare', async () => {
    stato.riga = { versione_testo: VECCHIA };
    expect(await vaChiestaSenzaTrattenere(() => db, 'maria', 2000), 'entra senza rileggere i 3.0').toBe('chiedi');
  });

  it('Lucia (data nel profilo, nessuna riga a verbale) viene mandata a riaccettare', async () => {
    stato.riga = null;
    expect(await vaChiestaSenzaTrattenere(() => db, 'lucia', 2000), 'la data da sola vale come accettazione').toBe('chiedi');
  });

  it('una riga senza versione non è un accettazione dei testi in vigore', async () => {
    stato.riga = { versione_testo: null };
    expect(await vaChiestaSenzaTrattenere(() => db, 'persona', 2000)).toBe('chiedi');
  });

  it('chi ha già a verbale i Termini 3.0 entra senza domande, e senza profilo non si chiede', async () => {
    stato.riga = { versione_testo: IN_VIGORE };
    expect(await vaChiestaSenzaTrattenere(() => db, 'persona', 2000)).toBe('lascia-entrare');
    stato.profilo = null;
    expect(await vaChiestaSenzaTrattenere(() => db, 'persona', 2000)).toBe('lascia-entrare');
  });

  it('la versione 2.0 scritta nei dati alla registrazione non vale come accettazione dei 3.0', () => {
    expect(versioneAccettata({ user_metadata: { versione_testi_accettati: VECCHIA } }), 'le porte la mettono a verbale e lasciano entrare').toBeNull();
    expect(versioneAccettata(null, VECCHIA)).toBeNull();
    expect(versioneAccettata({ user_metadata: { versione_testi_accettati: IN_VIGORE } })).toBe(IN_VIGORE);
    expect(versioneAccettata(null, IN_VIGORE)).toBe(IN_VIGORE);
  });

  it('il verbale scrive la riga dei 3.0 anche se nel profilo la data c era già', async () => {
    stato.riga = { versione_testo: VECCHIA };
    const esito = await verbalizzaAccettazione(db, { utenteId: 'maria', versione: IN_VIGORE, ip: null, userAgent: null });
    expect(esito, 'risponde «già accettata» guardando solo la data').toBe('registrata');
    expect(inseriti.find((i) => i.tabella === 'consent_log')?.riga.versione_testo).toBe(IN_VIGORE);
  });

  it('con la data e nessuna riga, il verbale scrive la riga; con i 3.0 già a verbale non scrive un doppione', async () => {
    stato.riga = null;
    expect(await verbalizzaAccettazione(db, { utenteId: 'lucia', versione: IN_VIGORE, ip: null, userAgent: null })).toBe('registrata');
    expect(inseriti.filter((i) => i.tabella === 'consent_log')).toHaveLength(1);
    inseriti.length = 0;
    stato.riga = { versione_testo: IN_VIGORE };
    expect(await verbalizzaAccettazione(db, { utenteId: 'lucia', versione: IN_VIGORE, ip: null, userAgent: null })).toBe('gia-accettata');
    expect(inseriti).toHaveLength(0);
  });
});

describe('La cassa e l area del negozio', () => {
  it('Lucia (data, nessuna riga) aprendo il pagamento viene mandata a riaccettare i Termini 3.0', async () => {
    stato.riga = null;
    expect(await doveLaManda('/checkout'), 'paga sotto i 3.0 senza averli visti').toBe('/accetta-condizioni?next=/checkout');
  });

  it('una riga senza versione non lascia pagare', async () => {
    stato.riga = { versione_testo: null };
    expect(await doveLaManda('/checkout')).toBe('/accetta-condizioni?next=/checkout');
  });

  it('un negozio già approvato coi Termini 2.0 riaccetta prima di entrare nella sua area', async () => {
    stato.profilo = { ...NEGOZIO };
    stato.riga = { versione_testo: VECCHIA };
    expect(await doveLaManda('/seller/dashboard'), 'il negozio lavora sotto i 3.0 senza averli riaccettati').toBe(
      '/accetta-condizioni?next=/seller/dashboard',
    );
    stato.riga = null;
    expect(await doveLaManda('/seller/orders')).toBe('/accetta-condizioni?next=/seller/orders');
  });

  it('un negozio che ha già accettato i 3.0 entra nella sua area senza domande', async () => {
    stato.profilo = { ...NEGOZIO };
    stato.riga = { versione_testo: IN_VIGORE };
    expect(await doveLaManda('/seller/dashboard')).not.toBe('/accetta-condizioni?next=/seller/dashboard');
  });
});
