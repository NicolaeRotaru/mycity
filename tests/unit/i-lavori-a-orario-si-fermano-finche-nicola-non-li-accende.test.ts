import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoGiroNotturno, type Tabelle } from './aiuti/finto-giro-notturno';
import { chiamataDelCalendarioFerma } from '@/lib/cron/fermo-dei-lavori';

/**
 * 31/10/2026 — I LAVORI A ORARIO SI FERMANO FINCHÉ NICOLA NON LI ACCENDE.
 *
 * Su Vercel manca la chiave di servizio del database: gli undici lavori di
 * `vercel.json` oggi rispondono «Service role non configurato» e non fanno
 * niente. Il giorno in cui la chiave arriva partirebbero tutti insieme, da soli,
 * su codice che in produzione non ha mai girato — compreso quello che cancella
 * gli account. Il fermo li tiene spenti finché `LAVORI_A_ORARIO` non vale
 * «accesi»; il primo giro si fa a mano, con `?a_mano=1`, un lavoro alla volta.
 *
 * Queste prove chiamano il gestore VERO di ogni rotta, con il segreto giusto, e
 * contano le chiamate al database. Il database finto, appena lo si tocca, lancia:
 * cosi' «zero chiamate» vuol dire che il lavoro non e' nemmeno partito, e «almeno
 * una» vuol dire che e' arrivato al lavoro vero. Tutto il resto (Stripe, la
 * chiave dell'AI, le notifiche push) e' configurato: fra la chiamata e il
 * database c'e' solo il fermo.
 */

const SEGRETO = 'segreto-del-calendario';
const DATABASE_RAGGIUNTO = 'finto: il lavoro ha raggiunto il database';

const finti = vi.hoisted(() => ({
  getAdminSupabase: vi.fn(),
  requireSupabaseService: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', async (originale) => ({
  ...(await originale<typeof import('@/lib/supabase/server')>()),
  getAdminSupabase: finti.getAdminSupabase,
}));
// send-emails si costruisce il client da sé: la chiave la prende qui, il client da supabase-js.
vi.mock('@/lib/env', async (originale) => ({
  ...(await originale<typeof import('@/lib/env')>()),
  requireSupabaseService: finti.requireSupabaseService,
}));
vi.mock('@supabase/supabase-js', async (originale) => ({
  ...(await originale<typeof import('@supabase/supabase-js')>()),
  createClient: finti.createClient,
}));
vi.mock('@/lib/push/send', async (originale) => ({
  ...(await originale<typeof import('@/lib/push/send')>()),
  isPushConfigured: () => true,
}));
// Il modulo vero importa `server-only`, che nelle prove non c'e'; il lavoro lo usa dopo il database.
vi.mock('@/lib/products/externalSync', () => ({ fetchExternalSnapshot: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));

type Gestore = (req: Request) => Promise<Response>;

/** Le undici rotte del calendario, una per una: la prova sotto controlla che siano tutte quelle di vercel.json. */
const ROTTE: Record<string, () => Promise<{ GET: unknown }>> = {
  'send-push': () => import('@/app/api/cron/send-push/route'),
  'send-emails': () => import('@/app/api/cron/send-emails/route'),
  'release-payouts': () => import('@/app/api/cron/release-payouts/route'),
  'operational-alerts': () => import('@/app/api/cron/operational-alerts/route'),
  'expire-checkouts': () => import('@/app/api/cron/expire-checkouts/route'),
  'expire-stale-orders': () => import('@/app/api/cron/expire-stale-orders/route'),
  'veloce-non-confermata': () => import('@/app/api/cron/veloce-non-confermata/route'),
  'abandoned-carts': () => import('@/app/api/cron/abandoned-carts/route'),
  'external-price-alerts': () => import('@/app/api/cron/external-price-alerts/route'),
  'process-deletions': () => import('@/app/api/cron/process-deletions/route'),
  'riquadra-casse': () => import('@/app/api/cron/riquadra-casse/route'),
};
const NOMI = Object.keys(ROTTE);

const chiamateAlDatabase = () =>
  finti.getAdminSupabase.mock.calls.length +
  finti.requireSupabaseService.mock.calls.length +
  finti.createClient.mock.calls.length;

type Esito = { stato: number | null; corpo: Record<string, unknown> | null };

/** Chiama la rotta come la chiama Vercel: GET, con il segreto nell'intestazione. */
async function chiama(nome: string, query = '', segreto = SEGRETO): Promise<Esito> {
  const { GET } = await ROTTE[nome]();
  const req = new Request(`http://localhost/api/cron/${nome}${query}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${segreto}` },
  });
  try {
    const r = await (GET as Gestore)(req);
    const corpo = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    return { stato: r.status, corpo };
  } catch {
    // Il database finto lancia appena lo si tocca: qui si guarda solo se e' stato toccato.
    return { stato: null, corpo: null };
  }
}

const lancia = () => {
  throw new Error(DATABASE_RAGGIUNTO);
};

beforeEach(() => {
  vi.clearAllMocks();
  finti.getAdminSupabase.mockImplementation(lancia);
  finti.requireSupabaseService.mockImplementation(lancia);
  finti.createClient.mockImplementation(lancia);
  process.env.CRON_SECRET = SEGRETO;
  // Il setup delle prove li accende per tutti: qui si parte come in produzione, senza variabile.
  delete process.env.LAVORI_A_ORARIO;
  delete process.env.CANCELLAZIONI_A_ORARIO;
  process.env.STRIPE_SECRET_KEY = 'sk_test_finta';
  process.env.ANTHROPIC_API_KEY = 'chiave-finta';
});

describe('il fermo copre tutti i lavori del calendario', () => {
  it('le rotte provate qui sono esattamente quelle che Vercel fa partire', () => {
    const vercel = JSON.parse(readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8')) as {
      crons: Array<{ path: string }>;
    };
    const delCalendario = vercel.crons.map((c) => c.path.replace('/api/cron/', '')).sort();
    expect(
      delCalendario,
      'un lavoro nuovo in vercel.json va aggiunto qui: senza la riga del fermo partirebbe da solo',
    ).toEqual([...NOMI].sort());
  });
});

describe.each(NOMI)('%s', (nome) => {
  it('senza LAVORI_A_ORARIO la chiamata del calendario risponde «fermo» e non tocca il database', async () => {
    const esito = await chiama(nome);
    expect(chiamateAlDatabase(), `${nome} ha toccato il database con il fermo acceso`).toBe(0);
    expect(esito.stato).toBe(200);
    expect(esito.corpo).toMatchObject({ ok: true, fermo: true });
    expect(String(esito.corpo?.motivo)).toContain('LAVORI_A_ORARIO');
    expect(String(esito.corpo?.motivo)).toContain('a_mano=1');
  });

  it('con ?a_mano=1 la chiamata arriva al lavoro vero', async () => {
    const esito = await chiama(nome, '?a_mano=1');
    expect(chiamateAlDatabase(), `${nome} a mano non e' arrivato al database`).toBeGreaterThan(0);
    expect(esito.corpo?.fermo).not.toBe(true);
  });

  it('con LAVORI_A_ORARIO=accesi lavora anche senza a_mano', async () => {
    process.env.LAVORI_A_ORARIO = 'accesi';
    const esito = await chiama(nome);
    expect(chiamateAlDatabase(), `${nome} acceso non e' arrivato al database`).toBeGreaterThan(0);
    expect(esito.corpo?.fermo).not.toBe(true);
  });

  it('a mano senza il segreto giusto resta un 401: il fermo non apre la porta', async () => {
    const esito = await chiama(nome, '?a_mano=1', 'segreto-sbagliato');
    expect(esito.stato).toBe(401);
    expect(chiamateAlDatabase()).toBe(0);
  });
});

describe('la regola del fermo', () => {
  const req = (query = '') => ({ url: `http://localhost/api/cron/send-push${query}` });

  it('solo «accesi» scritto esatto accende i lavori: un errore di battitura li lascia fermi', () => {
    expect(chiamataDelCalendarioFerma(req(), {})).toBe(true);
    expect(chiamataDelCalendarioFerma(req(), { LAVORI_A_ORARIO: 'accesi' })).toBe(false);
    for (const sbagliato of ['', 'Accesi', 'accesi ', 'ACCESI', 'true', '1', 'spenti']) {
      expect(chiamataDelCalendarioFerma(req(), { LAVORI_A_ORARIO: sbagliato }), `«${sbagliato}»`).toBe(true);
    }
  });

  it('a mano vuol dire a_mano=1, non un valore qualunque', () => {
    expect(chiamataDelCalendarioFerma(req('?a_mano=1'), {})).toBe(false);
    expect(chiamataDelCalendarioFerma(req('?x=2&a_mano=1'), {})).toBe(false);
    for (const q of ['?a_mano=0', '?a_mano=true', '?a_mano=', '?amano=1']) {
      expect(chiamataDelCalendarioFerma(req(q), {}), q).toBe(true);
    }
  });
});

describe('process-deletions: il primo giro conta e non cancella', () => {
  const VECCHIO = '2020-01-01T00:00:00.000Z';
  const ADESSO = new Date().toISOString();
  const FUTURO = '2099-01-01T00:00:00.000Z';

  /** Righe oltre la finestra e righe dentro, su ogni tabella che la notte pota. */
  const tabelle = (): Tabelle => ({
    activity_events: [
      { id: 'a', created_at: VECCHIO, ip: '1.2.3.4', category: 'visitor', metadata: { x: 1 }, summary: null },
      { id: 'b', created_at: VECCHIO, ip: null, category: 'auth', metadata: null, summary: null },
      { id: 'c', created_at: ADESSO, ip: '5.6.7.8', category: 'visitor', metadata: { y: 2 }, summary: 's' },
    ],
    audit_logs: [
      { id: 'd', created_at: VECCHIO, ip: '9.9.9.9', metadata: { z: 3 } },
      { id: 'e', created_at: ADESSO, ip: '8.8.8.8', metadata: { w: 4 } },
    ],
    contact_messages: [
      { id: 'f', created_at: VECCHIO },
      { id: 'g', created_at: ADESSO },
    ],
    newsletter_subscribers: [
      { id: 'h', created_at: VECCHIO, confirmed_at: null, unsubscribed_at: null, active: false },
      { id: 'i', created_at: VECCHIO, confirmed_at: null, unsubscribed_at: null, active: true },
    ],
    gift_cards: [
      { id: 'j', expires_at: VECCHIO, recipient_email: 'a@example.it', balance_cents: 500, redeemed_at: null },
      { id: 'k', expires_at: FUTURO, recipient_email: 'b@example.it', balance_cents: 0, redeemed_at: VECCHIO },
    ],
  });

  const scadute = [
    { user_id: 'utente-1', deleted_at: VECCHIO },
    { user_id: 'utente-2', deleted_at: VECCHIO },
  ];

  it('con a_mano=1&solo_conta=1 restituisce il conto e non scrive niente', async () => {
    const notte = fintoGiroNotturno({
      tabelle: tabelle(),
      rpc: { process_expired_deletions: { data: scadute, error: null } },
    });
    const prima = JSON.stringify(notte.db);
    finti.getAdminSupabase.mockImplementation(() => notte.admin);

    const esito = await chiama('process-deletions', '?a_mano=1&solo_conta=1');

    const scritture = notte.diario.filter((v) => v.op !== 'rpc');
    expect(scritture, 'il conto ha scritto o cancellato qualcosa').toEqual([]);
    expect(notte.diario.map((v) => (v.op === 'rpc' ? v.nome : v.op))).toEqual(['process_expired_deletions']);
    expect(JSON.stringify(notte.db)).toBe(prima);
    expect(notte.battitoScritto(), 'un conto non e\' un giro: niente battito').toBe(false);

    expect(esito.stato).toBe(200);
    expect(esito.corpo).toMatchObject({
      ok: true,
      soloConta: true,
      nienteCancellato: true,
      account: {
        quanti: 2,
        elenco: [
          { userId: 'utente-1', chiestaIl: VECCHIO },
          { userId: 'utente-2', chiestaIl: VECCHIO },
        ],
      },
    });
    const potature = esito.corpo?.potature as Array<{ cosa: string; righe: number | null; nonContata?: string }>;
    const righe = Object.fromEntries(potature.map((p) => [p.cosa, p.righe]));
    expect(righe).toMatchObject({
      'activity_events.ip': 1,
      'activity_events.profilo': 2,
      'audit_logs.ip': 1,
      'contact_messages': 1,
      'newsletter_subscribers': 1,
      'gift_cards': 1,
      'gift_cards_esauriti': 1,
    });
    // Le funzioni del database scrivono mentre leggono: non si contano, e la risposta lo dice.
    expect(potature.filter((p) => p.righe === null).map((p) => p.cosa).sort()).toEqual(
      ['consent_log', 'documenti-kyc-respinti', 'foto-consegna', 'product_views'],
    );
  });

  it('i conti sono quelli che la notte vera tocca, potatura per potatura', async () => {
    const soloConta = fintoGiroNotturno({
      tabelle: tabelle(),
      rpc: { process_expired_deletions: { data: [], error: null } },
    });
    finti.getAdminSupabase.mockImplementation(() => soloConta.admin);
    const conto = await chiama('process-deletions', '?a_mano=1&solo_conta=1');

    const vera = fintoGiroNotturno({
      tabelle: tabelle(),
      rpc: { process_expired_deletions: { data: [], error: null } },
    });
    finti.getAdminSupabase.mockImplementation(() => vera.admin);
    await chiama('process-deletions', '?a_mano=1&cancella=1');

    const toccateDavvero = vera.diario.flatMap((v) => (v.op === 'update' || v.op === 'delete' ? [v.toccate] : []));
    const contate = (conto.corpo?.potature as Array<{ righe: number | null }>)
      .filter((p) => p.righe !== null)
      .map((p) => p.righe);
    expect(toccateDavvero.length).toBeGreaterThan(0);
    expect(contate).toEqual(toccateDavvero);
  });

  /** Un giro con due account scaduti e righe da potare: dice se ha scritto qualcosa. */
  async function haScritto(query: string): Promise<boolean> {
    const notte = fintoGiroNotturno({
      tabelle: tabelle(),
      rpc: { process_expired_deletions: { data: scadute, error: null } },
    });
    finti.getAdminSupabase.mockImplementation(() => notte.admin);
    await chiama('process-deletions', query);
    return notte.diario.some((v) => v.op !== 'rpc');
  }

  // Le varianti scomode del collaudo: un errore di battitura, o la shell che
  // taglia l'indirizzo al primo «&», devono lasciare il giro a contare.
  it.each([
    ['?a_mano=1', 'solo a_mano, come quando la shell taglia «&solo_conta=1»'],
    ['?a_mano=1&solo_conta=true', 'solo_conta scritto «true»'],
    ['?a_mano=1&soloConta=1', 'soloConta col maiuscolo'],
    ['?a_mano=1&cancella=true', 'cancella scritto «true»'],
    ['?a_mano=1&cancella=1&solo_conta=1', 'cancella e solo_conta insieme: vince il conto'],
  ])('a mano con %s conta e non cancella niente (%s)', async (query) => {
    expect(await haScritto(query), `${query} ha cancellato`).toBe(false);
  });

  it('a mano cancella davvero solo con cancella=1 scritto esatto', async () => {
    expect(await haScritto('?a_mano=1&cancella=1')).toBe(true);
  });

  it('coi lavori accesi, la notte conta e basta finché le cancellazioni non hanno il loro interruttore', async () => {
    process.env.LAVORI_A_ORARIO = 'accesi';
    expect(await haScritto(''), 'la notte ha cancellato con le sole LAVORI_A_ORARIO accese').toBe(false);
    process.env.CANCELLAZIONI_A_ORARIO = 'Accese';
    expect(await haScritto(''), 'un errore di battitura ha acceso le cancellazioni').toBe(false);
    process.env.CANCELLAZIONI_A_ORARIO = 'accese';
    expect(await haScritto(''), 'con i due interruttori accesi la notte cancella').toBe(true);
  });

  // Coi due interruttori accesi, solo la chiamata del calendario (nessun parametro)
  // o cancella=1 cancellano: un parametro sbagliato conta, non fa la notte vera.
  it.each(['?a_mano=si', '?a_mano=1', '?soloConta=1', '?solo-conta=1', '?amano=1', '?x=1', '?cancella=true'])(
    'coi due interruttori accesi, %s conta e non cancella',
    async (query) => {
      process.env.LAVORI_A_ORARIO = 'accesi';
      process.env.CANCELLAZIONI_A_ORARIO = 'accese';
      expect(await haScritto(query), `${query} ha cancellato`).toBe(false);
    },
  );
});
