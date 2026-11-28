import { describe, it, expect, vi, beforeEach } from 'vitest';

import { fintoGiroNotturno, type Riga } from './aiuti/finto-giro-notturno';

/**
 * S08 (5/11/2026) — La rotta /api/account/delete e la strada a mano.
 * Il controllo d'accesso è finto (passa l'utente).
 *
 * 28/11/2026 (R09-010) — Il database è il finto unico delle prove della cancellazione
 * (tests/unit/aiuti/finto-giro-notturno.ts): tiene le righe e APPLICA i filtri. Prima qui c'era un
 * finto scritto a mano che rispondeva a ogni lettura con una lista fissa e registrava i filtri delle
 * scritture: le prove guardavano «quale filtro c'era», non «quale riga è cambiata».
 */

const UTENTE = { id: 'u-1', email: 'anna@example.com' };

const stato: {
  finto: ReturnType<typeof fintoGiroNotturno>;
  email: Array<Record<string, unknown>>;
  log: Array<{ livello: string; msg: string; ctx: unknown }>;
  senzaChiave: boolean;
} = {
  finto: fintoGiroNotturno(), email: [], log: [], senzaChiave: false,
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

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    if (stato.senzaChiave) throw new Error('Service role Supabase non configurato');
    return stato.finto.admin;
  },
}));

import { POST, GET, DELETE } from '@/app/api/account/delete/route';
import { identificativoAvviso } from '@/lib/privacy/avvisi-a-chi-aspetta';
import { chiaveAvviso } from '@/lib/cron-cancellazioni';

const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();
const chiama = (f: unknown) => (f as () => Promise<Response>)();

/** Il database di partenza: il profilo di Anna, senza richiesta, e le tabelle che la rotta tocca. */
function database(profilo: Riga = { id: UTENTE.id, deletion_requested_at: null }, altre: Record<string, Riga[]> = {}) {
  stato.finto = fintoGiroNotturno({
    tabelle: { profiles: [profilo], notifications: [], email_queue: [], abandoned_carts: [], ...altre },
  });
  return stato.finto;
}
const scrittureSu = (tabella: string) => stato.finto.diario.filter((v) => v.op === 'update' && v.tabella === tabella);

beforeEach(() => {
  database();
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
    const chiesta = giorniFa(10);
    const f = database({ id: UTENTE.id, deletion_requested_at: chiesta });
    f.guasti.push({ tabella: 'profiles', azione: 'select', messaggio: 'connessione persa' });
    const res = await chiama(POST);
    expect(res.status).toBe(503);
    expect(scrittureSu('profiles')).toHaveLength(0);
    expect(f.righe('profiles')[0].deletion_requested_at).toBe(chiesta);
  });

  it('scheda 2040 — la data si scrive solo se è ancora vuota', async () => {
    // Profilo vuoto: la data si scrive.
    await chiama(POST);
    await new Promise((r) => setTimeout(r, 0)); // l'avviso di questa prima richiesta parte dopo la risposta
    expect(stato.finto.righe('profiles')[0].deletion_requested_at).toEqual(expect.any(String));

    // Un'altra scheda scrive la sua data fra la lettura della rotta e la sua scrittura: quella resta.
    const altra = giorniFa(1);
    const scritteSopra: unknown[] = [];
    let letture = 0;
    const profilo: Riga = { id: UTENTE.id };
    Object.defineProperty(profilo, 'deletion_requested_at', {
      enumerable: true,
      get: () => (letture++ === 0 ? null : altra),
      set: (v: unknown) => { scritteSopra.push(v); },
    });
    database(profilo);
    stato.email = [];
    const corpo = await (await chiama(POST)).json();
    await new Promise((r) => setTimeout(r, 0));
    expect(scritteSopra, 'la data dell altra scheda è stata sovrascritta').toEqual([]);
    expect(corpo.alreadyRequested).toBe(true);
    expect(stato.email, 'una seconda email per la stessa richiesta').toHaveLength(0);
  });

  it('scheda 2041 — richiesta già registrata e ferma: la risposta porta motivo, rinvio e giorni', async () => {
    const chiesta = giorniFa(10);
    database({ id: UTENTE.id, deletion_requested_at: chiesta }, {
      notifications: [{
        id: identificativoAvviso(chiaveAvviso(UTENTE.id, chiesta, 'rinviata')),
        body: 'Cancellazione rinviata: 120,00 € da versare.',
        created_at: giorniFa(2),
      }],
    });
    const corpo = await (await chiama(POST)).json();
    expect(corpo.alreadyRequested).toBe(true);
    expect(corpo.rinviata).toBe(true);
    expect(corpo.motivo).toContain('120,00');
    expect(corpo.daysRemaining).toBe(0);
  });

  it('scheda 505 — dalla richiesta si chiudono le email in coda e il promemoria del carrello', async () => {
    const ultimaAttivita = giorniFa(1);
    const riga = (id: string, extra: Riga) => ({ id, user_id: UTENTE.id, sent_at: null, cancelled_at: null, ...extra });
    const f = database(undefined, {
      email_queue: [
        riga('promo', { template: 'first_order_promo' }),
        riga('pronto', { template: 'order_ready' }),
        riga('consegnato', { template: 'order_delivered' }),
        riga('gia-spedita', { template: 'first_order_promo', sent_at: giorniFa(2) }),
        riga('di-un-altro', { template: 'first_order_promo', user_id: 'u-2' }),
      ],
      abandoned_carts: [{ user_id: UTENTE.id, last_activity: ultimaAttivita, recovery_email_sent_at: null }],
    });
    await chiama(POST);
    const chiusa = (id: string) => f.righe('email_queue').find((r) => r.id === id)?.cancelled_at != null;
    expect(chiusa('promo'), 'la promozione in coda parte lo stesso').toBe(true);
    // Solo guida e promozioni: «ordine pronto» e «consegnato» restano, come le email già spedite e quelle degli altri.
    expect(chiusa('pronto')).toBe(false);
    expect(chiusa('consegnato')).toBe(false);
    expect(chiusa('gia-spedita')).toBe(false);
    expect(chiusa('di-un-altro')).toBe(false);
    // R30-003 — Il carrello si chiude col segno «senza email»: la sua ultima attività, non l'ora di adesso.
    expect(f.righe('abandoned_carts')[0].recovery_email_sent_at).toBe(ultimaAttivita);
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
    database({ id: UTENTE.id, deletion_requested_at: chiesta }, {
      notifications: [{
        id: identificativoAvviso(chiaveAvviso(UTENTE.id, chiesta, 'termine-scaduto')),
        body: 'Il termine è passato.',
        created_at: giorniFa(1),
      }],
    });
    const corpo = await (await chiama(GET)).json();
    expect(corpo.tappa).toBe('termine-scaduto');
  });

  it('scheda 2042 — se la rilettura del motivo cade, la risposta dice «non lo so», non «nessun rinvio»', async () => {
    const f = database({ id: UTENTE.id, deletion_requested_at: giorniFa(10) });
    f.guasti.push({ tabella: 'notifications', azione: 'select', messaggio: 'timeout' });
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
