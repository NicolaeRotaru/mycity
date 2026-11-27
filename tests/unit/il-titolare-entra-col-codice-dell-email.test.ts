import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/11/2026 — IL TITOLARE CONFERMA COL CODICE DELL'EMAIL ED ENTRA.
 *
 * Nicola: «dopo il click entra nella sua pagina venditore con l'abbonamento che ha scelto». Il collaudo della
 * sicurezza ha bocciato l'ingresso senza prova dell'email; Nicola ha scelto «codice dall'email».
 * Casi (dato → atteso):
 *  · /codice, preventivo aperto → l'email va sull'utente dell'attività (sbloccato), parte il codice;
 *    il preventivo resta APERTO, niente sblocco, nessun avviso a Nicola;
 *  · /codice su un preventivo accettato o chiuso → rifiuto; email già usata → messaggio generico, niente posta;
 *    email non partita → lo dice;
 *  · /conferma col codice giusto, browser vuoto → si accetta nella fascia confermata, la pagina si sblocca
 *    lì, la risposta porta i cookie della sessione ed `entra: /seller/abbonamento`; il link dell'email per
 *    rientrare nasce DOPO la verifica del codice;
 *  · codice sbagliato o scaduto → niente si accetta, niente cookie;
 *  · il codice apre un utente diverso da quello del link → niente;
 *  · un altro account già dentro → si accetta (l'email è provata) ma la sua sessione non si tocca: `entra` null;
 *  · preventivo già accettato → rifiuto senza verificare; senza chiavi Supabase → «riprova», niente si accetta;
 *  · richieste da un altro sito, Origin «null», corpo non JSON → rifiutate.
 */

const GC = '0de1905e-7000-4000-8000-0000000000aa';
const CODICE = 'c'.repeat(64);

const db = vi.hoisted(() => ({
  preventivo: null as null | { seller_id: string; codice: string; stato: string; fascia_scelta: string | null; profiles: { store_name: string } },
  posta: [] as Array<Record<string, unknown>>,
  link: [] as Array<Record<string, unknown>>,
  utente: [] as Array<Record<string, unknown>>,
  erroreUtente: null as null | { message: string; code?: string },
  postaRotta: false,
  sblocchi: [] as string[],
  avvisi: [] as string[],
  ordine: [] as string[],
  sessione: null as null | {
    altro: boolean;
    utenteDelCodice: string;
    verifiche: Array<{ email: string; codice: string }>;
    scritti: Array<{ name: string; value: string; options: Record<string, unknown> }>;
  },
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfterSec: 0, limit: 10 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => false }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: Record<string, unknown>) => {
    if (db.postaRotta) return { ok: false };
    db.ordine.push('email');
    db.posta.push(m);
    return { ok: true, id: 'e1' };
  }),
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async (titolo: string) => { db.avvisi.push(titolo); }) }));
vi.mock('@/lib/agenzia/abbonamento-contanti', () => ({
  sbloccaInContanti: vi.fn(async (_admin: unknown, _id: string, fascia: string) => { db.sblocchi.push(fascia); return { esito: 'sbloccata', fascia }; }),
  sbloccoRiuscito: () => true,
}));
vi.mock('@/lib/agenzia/entra-dal-link', () => ({
  sessioneDalLink: () => {
    const s = db.sessione;
    if (!s) return null;
    return {
      scritti: s.scritti,
      dentroUnAltro: async () => s.altro,
      entraColCodice: async (email: string, codice: string) => {
        db.ordine.push('verifica');
        s.verifiche.push({ email, codice });
        if (codice !== '123456') return null;
        s.scritti.push({ name: 'sb-test-auth-token', value: 'base64-sessione', options: { path: '/', sameSite: 'lax' } });
        return s.utenteDelCodice;
      },
    };
  },
}));
vi.mock('@/lib/supabase/server', () => {
  const tabellaPreventivi = () => ({
    select: () => ({ eq: (_c: string, codice: string) => ({ maybeSingle: async () => ({ data: db.preventivo && db.preventivo.codice === codice ? db.preventivo : null, error: null }) }) }),
    update: (valori: Record<string, unknown>) => {
      const filtri: Record<string, unknown> = {};
      const catena = {
        eq: (c: string, v: unknown) => { filtri[c] = v; return catena; },
        select: async () => {
          const p = db.preventivo;
          if (p && p.codice === filtri.codice && (filtri.stato === undefined || p.stato === filtri.stato)) {
            Object.assign(p, valori);
            return { data: [{ seller_id: p.seller_id }], error: null };
          }
          return { data: [], error: null };
        },
        then: (res: (v: unknown) => unknown) => {
          const p = db.preventivo;
          if (p && p.codice === filtri.codice) Object.assign(p, valori);
          return res({ error: null });
        },
      };
      return catena;
    },
  });
  return {
    getAdminSupabase: () => ({
      from: (t: string) => {
        if (t === 'preventivi_con_codice') return tabellaPreventivi();
        if (t === 'schede_clienti') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
        if (t === 'profiles') return {
          update: () => ({ eq: async () => ({ error: null }) }),
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { visibile_senza_abbonamento: false }, error: null }) }) }),
        };
        // Se scheda e pagella sono aperte (lib/agenzia/scheda-dopo-abbonamento.ts): nessun abbonamento.
        if (t === 'abbonamenti_servizi') return { select: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: [], error: null }) }), limit: async () => ({ data: [], error: null }) }) }) };
        throw new Error(`tabella inattesa ${t}`);
      },
      auth: {
        admin: {
          updateUserById: async (id: string, v: Record<string, unknown>) => {
            if (db.erroreUtente) return { data: null, error: db.erroreUtente };
            db.utente.push({ id, ...v });
            return { data: { user: { id } }, error: null };
          },
          generateLink: async (a: Record<string, unknown>) => {
            const n = db.link.length + 1;
            db.link.push(a);
            db.ordine.push(`link${n}`);
            return { data: { properties: { action_link: `https://supabase.test/verify?token=t${n}`, hashed_token: `hash-${n}`, email_otp: '123456' } }, error: null };
          },
        },
      },
    }),
  };
});

async function porta(percorso: 'codice' | 'conferma', corpo: Record<string, unknown>, intestazioni: Record<string, string> = {}) {
  const { POST } = percorso === 'codice'
    ? await import('@/app/api/preventivo/[codice]/codice/route')
    : await import('@/app/api/preventivo/[codice]/conferma/route');
  return POST(
    new Request(`https://mycity.example/api/preventivo/${CODICE}/${percorso}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...intestazioni },
      body: JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ codice: CODICE }) },
  );
}

const EMAIL = { email: 'titolare@grida.it', abbonamento: 'premium' };
const CONFERMA = { ...EMAIL, accettoCondizioni: true, codice: '123456' };

beforeEach(() => {
  vi.resetModules();
  db.preventivo = { seller_id: GC, codice: CODICE, stato: 'aperto', fascia_scelta: 'business', profiles: { store_name: 'Grida Caffè' } };
  db.posta = [];
  db.link = [];
  db.utente = [];
  db.erroreUtente = null;
  db.postaRotta = false;
  db.sblocchi = [];
  db.avvisi = [];
  db.ordine = [];
  db.sessione = { altro: false, utenteDelCodice: GC, verifiche: [], scritti: [] };
});

describe('il codice parte, e il preventivo resta aperto', () => {
  it('l email va sull utente dell attività, parte il codice, niente si accetta', async () => {
    const r = await porta('codice', EMAIL);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, data: { inviato: true } });
    expect(db.utente).toEqual([{ id: GC, email: 'titolare@grida.it', email_confirm: true, ban_duration: 'none' }]);
    expect(db.link[0]).toEqual({ type: 'magiclink', email: 'titolare@grida.it' });
    expect(db.posta).toHaveLength(1);
    expect(db.posta[0].to).toBe('titolare@grida.it');
    expect(String(db.posta[0].subject)).toContain('123456');
    expect(String(db.posta[0].html)).toContain('Premium');
    expect(db.preventivo?.stato).toBe('aperto');
    expect(db.sblocchi).toEqual([]);
    expect(db.avvisi).toEqual([]);
  });

  it('su un preventivo accettato o chiuso non parte niente', async () => {
    db.preventivo!.stato = 'accettato';
    expect((await porta('codice', EMAIL)).status).toBe(409);
    db.preventivo!.stato = 'chiuso';
    expect((await porta('codice', EMAIL)).status).toBe(409);
    expect(db.posta).toEqual([]);
  });

  it('un email già usata: messaggio generico, nessuna posta', async () => {
    db.erroreUtente = { message: 'A user with this email address has already been registered', code: 'email_exists' };
    const r = await porta('codice', EMAIL);
    expect(r.status).toBe(409);
    expect((await r.json()).error.message).toContain('Non sono riuscito a collegare questa email');
    expect(db.posta).toEqual([]);
  });

  it('se l email non parte, lo dice', async () => {
    db.postaRotta = true;
    const r = await porta('codice', EMAIL);
    expect(r.status).toBe(503);
    expect((await r.json()).error.message).toContain('Non sono riuscito a mandarti il codice');
  });
});

describe('col codice giusto si accetta e si entra', () => {
  it('browser vuoto: accetta nella fascia confermata, sblocca lì, e la risposta apre la sessione', async () => {
    const r = await porta('conferma', CONFERMA);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, data: { url: null, accessoInviato: true, entra: '/seller/abbonamento' } });
    expect(r.headers.get('set-cookie') ?? '').toContain('sb-test-auth-token=base64-sessione');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(db.sessione!.verifiche).toEqual([{ email: 'titolare@grida.it', codice: '123456' }]);
    expect(db.preventivo?.stato).toBe('accettato');
    expect(db.preventivo?.fascia_scelta).toBe('premium');
    expect(db.sblocchi).toEqual(['premium']);
    expect(db.avvisi).toHaveLength(1);
    // Il link dell'email per rientrare nasce dopo la verifica del codice, così resta buono.
    expect(db.ordine).toEqual(['verifica', 'link1', 'email']);
  });

  it('un codice sbagliato o scaduto: niente si accetta, niente cookie', async () => {
    const r = await porta('conferma', { ...CONFERMA, codice: '000000' });
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toContain('Il codice non è giusto o è scaduto');
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(db.preventivo?.stato).toBe('aperto');
    expect(db.sblocchi).toEqual([]);
    expect(db.posta).toEqual([]);
  });

  it('se il codice apre un utente diverso da quello del link, niente', async () => {
    db.sessione!.utenteDelCodice = 'altro-utente';
    const r = await porta('conferma', CONFERMA);
    expect(r.status).toBe(400);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(db.preventivo?.stato).toBe('aperto');
  });

  it('con un altro account già dentro: si accetta, ma la sua sessione non si tocca', async () => {
    db.sessione!.altro = true;
    const r = await porta('conferma', CONFERMA);
    const corpo = await r.json();
    expect(corpo.ok).toBe(true);
    expect(corpo.data.entra).toBeNull();
    expect(corpo.data.accessoInviato).toBe(true);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(db.preventivo?.stato).toBe('accettato');
  });

  it('senza il codice non si va avanti', async () => {
    const { codice: _via, ...senza } = CONFERMA;
    const r = await porta('conferma', senza);
    expect(r.status).toBe(400);
    expect(db.sessione!.verifiche).toEqual([]);
    expect(db.preventivo?.stato).toBe('aperto');
  });

  it('un preventivo già accettato si rifiuta senza verificare il codice', async () => {
    db.preventivo!.stato = 'accettato';
    const r = await porta('conferma', CONFERMA);
    expect(r.status).toBe(409);
    expect(db.sessione!.verifiche).toEqual([]);
  });

  it('senza le chiavi di Supabase non si accetta niente', async () => {
    db.sessione = null;
    const r = await porta('conferma', CONFERMA);
    expect(r.status).toBe(503);
    expect(db.preventivo?.stato).toBe('aperto');
  });
});

describe('le porte accettano solo JSON partito dal sito', () => {
  for (const percorso of ['codice', 'conferma'] as const) {
    it(`${percorso}: da un altro sito, da Origin «null» o con un corpo non JSON → rifiutata`, async () => {
      const corpo = percorso === 'codice' ? EMAIL : CONFERMA;
      expect((await porta(percorso, corpo, { origin: 'https://altro-sito.example' })).status).toBe(403);
      expect((await porta(percorso, corpo, { origin: 'null' })).status).toBe(403);
      expect((await porta(percorso, corpo, { 'content-type': 'text/plain' })).status).toBe(400);
      expect(db.posta).toEqual([]);
      expect(db.preventivo?.stato).toBe('aperto');
      expect((await porta(percorso, corpo, { origin: 'https://mycity.example' })).status).toBe(200);
    });
  }
});
