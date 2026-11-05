import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S08 (5/11/2026) — La rotta /api/account/delete e la strada a mano.
 * Il controllo d'accesso è finto (passa l'utente); il database è un finto che
 * registra ogni scrittura con i suoi filtri.
 */

const UTENTE = { id: 'u-1', email: 'anna@example.com' };

type Scrittura = { tabella: string; valori: Record<string, unknown>; filtri: Array<[string, string, unknown]> };
const stato: {
  profilo: { deletion_requested_at: string | null } | null;
  erroreProfilo: { message: string } | null;
  erroreNotifiche: { message: string } | null;
  notifiche: Array<{ id: string; body: string; created_at: string }>;
  scritture: Scrittura[];
  email: Array<Record<string, unknown>>;
  log: Array<{ livello: string; msg: string; ctx: unknown }>;
  senzaChiave: boolean;
} = {
  profilo: null, erroreProfilo: null, erroreNotifiche: null, notifiche: [], scritture: [], email: [], log: [], senzaChiave: false,
};

vi.mock('@/lib/api/middleware', () => ({
  withAuth: (handler: (ctx: { user: typeof UTENTE }) => unknown, opzioni?: { seMancaLaChiave?: (chi: unknown, e: unknown) => unknown }) =>
    () => (stato.senzaChiave && opzioni?.seMancaLaChiave ? opzioni.seMancaLaChiave({ user: UTENTE }, new Error('manca')) : handler({ user: UTENTE })),
  withAuthRateLimit: (opts: { seMancaLaChiave?: (chi: unknown, e: unknown) => unknown }, handler: (ctx: { user: typeof UTENTE }) => unknown) =>
    () => (stato.senzaChiave && opts.seMancaLaChiave ? opts.seMancaLaChiave({ user: UTENTE }, new Error('manca')) : handler({ user: UTENTE })),
}));
vi.mock('@/lib/logger', () => {
  const l = (livello: string) => (msg: string, ctx?: unknown) => { stato.log.push({ livello, msg, ctx }); };
  return { logger: { error: l('error'), warn: l('warn'), info: l('info'), debug: l('debug'), spesa: l('spesa') } };
});
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (l: Record<string, unknown>) => { stato.email.push(l); return { ok: true, id: 'e' }; },
}));
vi.mock('@/lib/api/dopo-la-risposta', () => ({
  dopoLaRisposta: (lavoro: () => Promise<void>) => { void lavoro(); },
}));

function adminFinto() {
  return {
    from(tabella: string) {
      const filtri: Array<[string, string, unknown]> = [];
      let valori: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (c: string, v: unknown) => { filtri.push(['eq', c, v]); return q; };
      q.is = (c: string, v: unknown) => { filtri.push(['is', c, v]); return q; };
      q.in = (c: string, v: unknown) => { filtri.push(['in', c, v]); return q; };
      q.update = (v: Record<string, unknown>) => { valori = v; return q; };
      q.single = async () => ({ data: stato.erroreProfilo ? null : stato.profilo, error: stato.erroreProfilo });
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        if (valori) {
          stato.scritture.push({ tabella, valori, filtri: [...filtri] });
          return Promise.resolve({ data: null, error: null }).then(ok, ko);
        }
        if (tabella === 'notifications') {
          if (stato.erroreNotifiche) return Promise.resolve({ data: null, error: stato.erroreNotifiche }).then(ok, ko);
          const id = filtri.find((f) => f[1] === 'id')?.[2];
          return Promise.resolve({ data: stato.notifiche.filter((n) => n.id === id), error: null }).then(ok, ko);
        }
        return Promise.resolve({ data: [], error: null }).then(ok, ko);
      };
      return q;
    },
  };
}
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    if (stato.senzaChiave) throw new Error('Service role Supabase non configurato');
    return adminFinto();
  },
}));

import { POST, GET, DELETE } from '@/app/api/account/delete/route';
import { identificativoAvviso } from '@/lib/privacy/avvisi-a-chi-aspetta';
import { chiaveAvviso } from '@/lib/cron-cancellazioni';

const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();
const chiama = (f: unknown) => (f as () => Promise<Response>)();

beforeEach(() => {
  stato.profilo = { deletion_requested_at: null };
  stato.erroreProfilo = null;
  stato.erroreNotifiche = null;
  stato.notifiche = [];
  stato.scritture = [];
  stato.email = [];
  stato.log = [];
  stato.senzaChiave = false;
  delete process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY;
  delete process.env.SUPPORT_EMAIL;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
});

describe('chiedere la cancellazione', () => {
  it('scheda 2040 — se la lettura del profilo cade, non si scrive niente e non si azzera la data', async () => {
    stato.profilo = { deletion_requested_at: giorniFa(10) };
    stato.erroreProfilo = { message: 'connessione persa' };
    const res = await chiama(POST);
    expect(res.status).toBe(503);
    expect(stato.scritture.filter((s) => s.tabella === 'profiles')).toHaveLength(0);
  });

  it('scheda 2040 — la data si scrive solo se è ancora vuota', async () => {
    await chiama(POST);
    const scrittura = stato.scritture.find((s) => s.tabella === 'profiles')!;
    expect(scrittura.filtri).toContainEqual(['is', 'deletion_requested_at', null]);
  });

  it('scheda 2041 — richiesta già registrata e ferma: la risposta porta motivo, rinvio e giorni', async () => {
    const chiesta = giorniFa(10);
    stato.profilo = { deletion_requested_at: chiesta };
    stato.notifiche = [{
      id: identificativoAvviso(chiaveAvviso(UTENTE.id, chiesta, 'rinviata')),
      body: 'Cancellazione rinviata: 120,00 € da versare.',
      created_at: giorniFa(2),
    }];
    const corpo = await (await chiama(POST)).json();
    expect(corpo.alreadyRequested).toBe(true);
    expect(corpo.rinviata).toBe(true);
    expect(corpo.motivo).toContain('120,00');
    expect(corpo.daysRemaining).toBe(0);
  });

  it('scheda 505 — dalla richiesta si chiudono le email in coda e il promemoria del carrello', async () => {
    await chiama(POST);
    const coda = stato.scritture.find((s) => s.tabella === 'email_queue');
    expect(coda?.valori).toHaveProperty('cancelled_at');
    expect(coda?.filtri).toContainEqual(['eq', 'user_id', UTENTE.id]);
    expect(coda?.filtri).toContainEqual(['is', 'sent_at', null]);
    // Solo guida e promozioni: «ordine pronto» e «consegnato» restano.
    const soloQuesti = coda?.filtri.find((f) => f[0] === 'in' && f[1] === 'template')?.[2] as string[];
    expect(soloQuesti).toContain('first_order_promo');
    expect(soloQuesti).not.toContain('order_ready');
    expect(soloQuesti).not.toContain('order_delivered');
    const carrello = stato.scritture.find((s) => s.tabella === 'abandoned_carts');
    expect(carrello?.valori).toHaveProperty('recovery_email_sent_at');
  });

  it('scheda 222 — il titolare riceve subito l avviso col giorno e la strada per annullare', async () => {
    await chiama(POST);
    await new Promise((r) => setTimeout(r, 0));
    expect(stato.email).toHaveLength(1);
    expect(stato.email[0].to).toBe(UTENTE.email);
    expect(stato.email[0].tipo).toBe('transazionale');
    expect(String(stato.email[0].html)).toContain('/profile/settings?tab=danger');
    expect(String(stato.email[0].text)).toMatch(/Annulla la richiesta/);
  });
});

describe('lo stato della richiesta (GET)', () => {
  it('scheda 2016 — dice la tappa: un rinvio motivato o il termine di legge passato', async () => {
    const chiesta = giorniFa(40);
    stato.profilo = { deletion_requested_at: chiesta };
    stato.notifiche = [{
      id: identificativoAvviso(chiaveAvviso(UTENTE.id, chiesta, 'termine-scaduto')),
      body: 'Il termine è passato.',
      created_at: giorniFa(1),
    }];
    const corpo = await (await chiama(GET)).json();
    expect(corpo.tappa).toBe('termine-scaduto');
  });

  it('scheda 2042 — se la rilettura del motivo cade, la risposta dice «non lo so», non «nessun rinvio»', async () => {
    stato.profilo = { deletion_requested_at: giorniFa(10) };
    stato.erroreNotifiche = { message: 'timeout' };
    const corpo = await (await chiama(GET)).json();
    expect(corpo.letturaFallita).toBe(true);
    expect(corpo.rinviata).not.toBe(false);
  });
});

describe('senza la chiave di servizio', () => {
  it('scheda 2057 — il registro annota chi ha chiesto e quale diritto', async () => {
    stato.senzaChiave = true;
    await chiama(POST);
    const riga = stato.log.find((l) => l.msg.includes('manca la chiave di servizio'));
    expect(riga?.ctx).toMatchObject({ utente: UTENTE.id, diritto: "Cancellare l'account" });
  });

  it('scheda 2057 — senza nessun canale la frase cita il Garante e non dà la colpa alla casella', async () => {
    stato.senzaChiave = true;
    const corpo = await (await chiama(POST)).json();
    expect(corpo.error.message).toContain('Garante');
    expect(corpo.error.message).not.toMatch(/quindi la tua richiesta/);
  });

  it('scheda 2056 — la porta «Annulla» non promette un mese e l oggetto dice l urgenza', async () => {
    stato.senzaChiave = true;
    process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY = 'privacy@mycity-marketplace.com';
    const corpo = await (await chiama(DELETE)).json();
    expect(corpo.error.message).not.toContain('entro un mese');
    expect(corpo.error.message).toContain('7 giorni');
    expect(decodeURIComponent(corpo.error.details.recapito.href)).toContain('Fermate la cancellazione');
  });
});
