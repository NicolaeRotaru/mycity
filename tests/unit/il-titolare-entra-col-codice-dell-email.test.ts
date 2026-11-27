import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 27/11/2026 — IL TITOLARE CONFERMA COL CODICE DELL'EMAIL ED ENTRA.
 *
 * Nicola: «dopo il click entra nella sua pagina venditore con l'abbonamento che ha scelto», e «codice
 * dall'email». Due collaudi della sicurezza hanno bocciato le forme di prima: entrare senza provare l'email,
 * poi mettere l'email sull'utente del negozio già per mandare il codice. Ora il codice lo fa il sito
 * (lib/agenzia/codice-dal-link.ts, qui VERO, non finto) e il negozio non si tocca finché non torna giusto.
 * Casi (dato → atteso):
 *  · /codice → parte il codice all'email scritta, torna un gettone; l'utente del negozio NON si tocca, nessun
 *    link di Supabase, il preventivo resta aperto, nessun avviso. Stessa risposta per qualunque email;
 *  · /codice su un preventivo accettato o chiuso → rifiuto; email non partita → lo dice; il codice non sta
 *    nell'oggetto dell'email;
 *  · /accetta col codice giusto, browser vuoto → si accetta nella fascia confermata, si sblocca lì, l'email va
 *    sull'utente solo ora, la risposta porta i cookie ed `entra: /seller/abbonamento`; il gettone della sessione
 *    nasce prima del link dell'email;
 *  · codice sbagliato, codice di un'altra email, gettone ritoccato, codice scaduto, troppi tentativi, codice o
 *    gettone mancanti → niente si accetta e l'utente non si tocca;
 *  · un altro account già dentro → si accetta (l'email è provata) ma la sua sessione non si tocca: `entra` null;
 *  · da un altro sito, da Origin «null», con un corpo non JSON → rifiutate tutte e due le porte.
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
  contatori: new Map<string, number>(),
  sessione: null as null | {
    altro: boolean;
    gettoni: string[];
    scritti: Array<{ name: string; value: string; options: Record<string, unknown> }>;
  },
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
// Il tetto vero, contato in memoria: serve alla prova dei troppi tentativi.
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async (o: { key: string; max: number }) => {
    const n = (db.contatori.get(o.key) ?? 0) + 1;
    db.contatori.set(o.key, n);
    return { allowed: n <= o.max, remaining: Math.max(0, o.max - n), retryAfterSec: 60, limit: o.max };
  }),
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
      entra: async (gettone: string) => {
        db.ordine.push(`sessione:${gettone}`);
        s.gettoni.push(gettone);
        s.scritti.push({ name: 'sb-test-auth-token', value: 'base64-sessione', options: { path: '/', sameSite: 'lax' } });
        return true;
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

async function porta(percorso: 'codice' | 'accetta', corpo: Record<string, unknown>, intestazioni: Record<string, string> = {}) {
  const { POST } = percorso === 'codice'
    ? await import('@/app/api/preventivo/[codice]/codice/route')
    : await import('@/app/api/preventivo/[codice]/accetta/route');
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

/** Chiede il codice e lo legge dall'email, come il titolare. */
async function chiediCodice(email = EMAIL.email): Promise<{ codice: string; gettone: string }> {
  const r = await porta('codice', { ...EMAIL, email });
  const corpo = await r.json();
  const html = String(db.posta.at(-1)?.html ?? '');
  const codice = /letter-spacing:8px[^>]*>(\d{6})</.exec(html)?.[1] ?? '';
  return { codice, gettone: corpo.data?.gettone ?? '' };
}

const conferma = (c: { codice: string; gettone: string }, altro: Record<string, unknown> = {}) =>
  porta('accetta', { ...EMAIL, accettoCondizioni: true, ...c, ...altro });

beforeEach(() => {
  vi.resetModules();
  process.env.CODICE_PREVENTIVO_SECRET = 'segreto-delle-prove-abbastanza-lungo';
  db.preventivo = { seller_id: GC, codice: CODICE, stato: 'aperto', fascia_scelta: 'business', profiles: { store_name: 'Grida Caffè' } };
  db.posta = [];
  db.link = [];
  db.utente = [];
  db.erroreUtente = null;
  db.postaRotta = false;
  db.sblocchi = [];
  db.avvisi = [];
  db.ordine = [];
  db.contatori = new Map();
  db.sessione = { altro: false, gettoni: [], scritti: [] };
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CODICE_PREVENTIVO_SECRET;
});

describe('il codice parte, e il negozio non si tocca', () => {
  it('parte all email scritta, torna un gettone, e niente cambia: utente, preventivo, avvisi', async () => {
    const r = await porta('codice', EMAIL);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(typeof corpo.data.gettone).toBe('string');
    expect(db.posta).toHaveLength(1);
    expect(db.posta[0].to).toBe('titolare@grida.it');
    const codice = /letter-spacing:8px[^>]*>(\d{6})</.exec(String(db.posta[0].html))?.[1];
    expect(codice).toMatch(/^\d{6}$/);
    // Il codice non si legge sulle notifiche (oggetto) e non torna al browser (gettone).
    expect(String(db.posta[0].subject)).not.toContain(codice!);
    expect(Buffer.from(corpo.data.gettone, 'base64url').toString()).not.toContain(codice!);
    expect(String(db.posta[0].html)).toContain('Premium');
    expect(db.utente).toEqual([]);
    expect(db.link).toEqual([]);
    expect(db.preventivo?.stato).toBe('aperto');
    expect(db.sblocchi).toEqual([]);
    expect(db.avvisi).toEqual([]);
  });

  it('stessa risposta per qualunque email: da qui non si scopre chi è iscritto', async () => {
    db.erroreUtente = { message: 'already registered', code: 'email_exists' };
    expect((await porta('codice', { ...EMAIL, email: 'gia@iscritta.it' })).status).toBe(200);
    expect((await porta('codice', { ...EMAIL, email: 'nuova@libera.it' })).status).toBe(200);
  });

  it('su un preventivo accettato o chiuso non parte niente', async () => {
    db.preventivo!.stato = 'accettato';
    expect((await porta('codice', EMAIL)).status).toBe(409);
    db.preventivo!.stato = 'chiuso';
    expect((await porta('codice', EMAIL)).status).toBe(409);
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
  it('browser vuoto: accetta nella fascia confermata, l email va sull utente solo ora, e la risposta apre la sessione', async () => {
    const c = await chiediCodice();
    db.ordine = [];
    const r = await conferma(c);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, data: { url: null, accessoInviato: true, entra: '/seller/abbonamento' } });
    expect(r.headers.get('set-cookie') ?? '').toContain('sb-test-auth-token=base64-sessione');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(db.utente).toEqual([{ id: GC, email: 'titolare@grida.it', email_confirm: true, ban_duration: 'none' }]);
    expect(db.preventivo?.stato).toBe('accettato');
    expect(db.preventivo?.fascia_scelta).toBe('premium');
    expect(db.sblocchi).toEqual(['premium']);
    expect(db.avvisi).toHaveLength(1);
    // Il gettone della sessione nasce prima del link dell'email per rientrare, così quello resta buono.
    expect(db.ordine).toEqual(['link1', 'sessione:hash-1', 'link2', 'email']);
  });

  it('con un altro account già dentro: si accetta, ma la sua sessione non si tocca', async () => {
    const c = await chiediCodice();
    db.sessione!.altro = true;
    const r = await conferma(c);
    const corpo = await r.json();
    expect(corpo.ok).toBe(true);
    expect(corpo.data.entra).toBeNull();
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(db.sessione!.gettoni).toEqual([]);
    expect(db.preventivo?.stato).toBe('accettato');
  });
});

describe('senza il codice giusto niente si accetta e il negozio non si tocca', () => {
  const nienteCambia = () => {
    expect(db.utente).toEqual([]);
    expect(db.preventivo?.stato).toBe('aperto');
    expect(db.sblocchi).toEqual([]);
    expect(db.avvisi).toEqual([]);
  };

  it('un codice sbagliato', async () => {
    const c = await chiediCodice();
    const sbagliato = c.codice === '000000' ? '111111' : '000000';
    const r = await conferma({ ...c, codice: sbagliato });
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toContain('Il codice non è giusto');
    expect(r.headers.get('set-cookie')).toBeNull();
    nienteCambia();
  });

  it('il codice arrivato a un altra email, usato con l email vera del titolare (la falla dei collaudi)', async () => {
    const delVenditore = await chiediCodice('venditore@esempio.it');
    const r = await conferma(delVenditore, { email: 'titolare@grida.it' });
    expect(r.status).toBe(400);
    nienteCambia();
  });

  it('un gettone ritoccato per cambiare l email', async () => {
    const c = await chiediCodice('venditore@esempio.it');
    const dentro = JSON.parse(Buffer.from(c.gettone, 'base64url').toString());
    const ritoccato = Buffer.from(JSON.stringify({ ...dentro, e: 'titolare@grida.it' })).toString('base64url');
    const r = await conferma({ codice: c.codice, gettone: ritoccato });
    expect(r.status).toBe(400);
    nienteCambia();
  });

  it('un codice scaduto (dopo 10 minuti)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-27T16:00:00Z'));
    const c = await chiediCodice();
    vi.setSystemTime(new Date('2026-11-27T16:10:01Z'));
    const r = await conferma(c);
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toContain('scaduto');
    nienteCambia();
  });

  it('al sesto tentativo sullo stesso gettone serve un codice nuovo, anche se quello scritto è giusto', async () => {
    const c = await chiediCodice();
    const sbagliato = c.codice === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) expect((await conferma({ ...c, codice: sbagliato })).status).toBe(400);
    const r = await conferma(c);
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toContain('troppe volte');
    nienteCambia();
  });

  it('senza codice o senza gettone', async () => {
    const c = await chiediCodice();
    expect((await porta('accetta', { ...EMAIL, accettoCondizioni: true, gettone: c.gettone })).status).toBe(400);
    expect((await porta('accetta', { ...EMAIL, accettoCondizioni: true, codice: c.codice })).status).toBe(400);
    nienteCambia();
  });

  it('senza il segreto sul server non parte nessun codice e non si accetta niente', async () => {
    const c = await chiediCodice();
    delete process.env.CODICE_PREVENTIVO_SECRET;
    vi.resetModules();
    expect((await porta('codice', EMAIL)).status).toBe(503);
    expect((await conferma(c)).status).toBe(400);
    nienteCambia();
  });
});

describe('le porte accettano solo JSON partito dal sito', () => {
  for (const percorso of ['codice', 'accetta'] as const) {
    it(`${percorso}: da un altro sito, da Origin «null» o con un corpo non JSON → rifiutata`, async () => {
      const corpo = percorso === 'codice' ? EMAIL : { ...EMAIL, accettoCondizioni: true, codice: '123456', gettone: 'x'.repeat(20) };
      expect((await porta(percorso, corpo, { origin: 'https://altro-sito.example' })).status).toBe(403);
      expect((await porta(percorso, corpo, { origin: 'null' })).status).toBe(403);
      expect((await porta(percorso, corpo, { 'content-type': 'text/plain' })).status).toBe(400);
      expect(db.posta).toEqual([]);
      expect(db.preventivo?.stato).toBe('aperto');
    });
  }
  it('dal sito stesso passa', async () => {
    expect((await porta('codice', EMAIL, { origin: 'https://mycity.example' })).status).toBe(200);
  });
});
