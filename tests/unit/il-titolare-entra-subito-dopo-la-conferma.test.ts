import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/11/2026 15:06 — Nicola: «dopo il click entra nella sua pagina venditore con l'abbonamento che ha scelto».
 *
 * La conferma dal link (app/api/preventivo/[codice]/accetta) ora apre anche la sessione del titolare.
 * Casi (dato → atteso):
 *  · browser vuoto, gettone buono → risposta con `entra: /seller/abbonamento` e i cookie della sessione;
 *    il gettone passato alla sessione è quello creato per lei, e il link dell'email nasce DOPO, così resta buono;
 *  · la pagina si sblocca nella fascia che il titolare ha confermato (anche se il venditore ne aveva un'altra);
 *  · nel browser c'è già dentro un altro account (Nicola che prova il link) → la sua sessione non si tocca,
 *    `entra` è null, nessun gettone in più, l'email parte come prima;
 *  · il gettone non apre la sessione → `entra` null, la conferma resta valida, l'email parte;
 *  · senza le chiavi pubbliche di Supabase → `entra` null, la conferma resta valida;
 *  · una richiesta da un altro sito → rifiutata, e il preventivo resta aperto.
 */

const GC = '0de1905e-7000-4000-8000-0000000000aa';
const CODICE = 'c'.repeat(64);

const db = vi.hoisted(() => ({
  preventivo: null as null | { seller_id: string; codice: string; stato: string; fascia_scelta: string | null; profiles: { store_name: string } },
  posta: [] as Array<Record<string, unknown>>,
  link: [] as Array<Record<string, unknown>>,
  sblocchi: [] as string[],
  ordine: [] as string[],
  sessione: null as null | {
    altro: boolean;
    entra: boolean;
    gettoni: string[];
    scritti: Array<{ name: string; value: string; options: Record<string, unknown> }>;
  },
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfterSec: 0, limit: 10 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => false }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async (m: Record<string, unknown>) => { db.ordine.push('email'); db.posta.push(m); return { ok: true, id: 'e1' }; }) }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
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
        if (s.entra) s.scritti.push({ name: 'sb-test-auth-token', value: 'base64-sessione', options: { path: '/', httpOnly: false, sameSite: 'lax' } });
        return s.entra;
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
          updateUserById: async (id: string) => ({ data: { user: { id } }, error: null }),
          generateLink: async (a: Record<string, unknown>) => {
            const n = db.link.length + 1;
            db.link.push(a);
            db.ordine.push(`link${n}`);
            return { data: { properties: { action_link: `https://supabase.test/verify?token=t${n}`, hashed_token: `hash-${n}` } }, error: null };
          },
        },
      },
    }),
  };
});

async function conferma(corpo: Record<string, unknown>, intestazioni: Record<string, string> = {}) {
  const { POST } = await import('@/app/api/preventivo/[codice]/accetta/route');
  return POST(
    new Request(`https://mycity.example/api/preventivo/${CODICE}/accetta`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...intestazioni },
      body: JSON.stringify(corpo),
    }) as never,
    { params: Promise.resolve({ codice: CODICE }) },
  );
}

const BUONO = { email: 'titolare@grida.it', abbonamento: 'premium', accettoCondizioni: true };

beforeEach(() => {
  vi.resetModules();
  db.preventivo = { seller_id: GC, codice: CODICE, stato: 'aperto', fascia_scelta: 'business', profiles: { store_name: 'Grida Caffè' } };
  db.posta = [];
  db.link = [];
  db.sblocchi = [];
  db.ordine = [];
  db.sessione = { altro: false, entra: true, gettoni: [], scritti: [] };
});

describe('dopo la conferma il titolare entra subito nella sua pagina', () => {
  it('browser vuoto: la risposta dice dove entrare e porta i cookie della sessione', async () => {
    const r = await conferma(BUONO);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo).toEqual({ ok: true, data: { url: null, accessoInviato: true, entra: '/seller/abbonamento' } });
    expect(r.headers.get('set-cookie') ?? '').toContain('sb-test-auth-token=base64-sessione');
    expect(r.headers.get('cache-control')).toBe('no-store');
    // Il gettone della sessione è il primo, creato per lei; il link dell'email nasce dopo e parte dopo.
    expect(db.sessione!.gettoni).toEqual(['hash-1']);
    expect(db.ordine).toEqual(['link1', 'sessione:hash-1', 'link2', 'email']);
    expect(db.link[0]).toEqual({ type: 'magiclink', email: 'titolare@grida.it' });
    expect(String(JSON.stringify(db.posta[0]))).toContain('token=t2');
  });

  it('la pagina si sblocca nella fascia confermata dal titolare, non in quella del venditore', async () => {
    await conferma(BUONO);
    expect(db.sblocchi).toEqual(['premium']);
    expect(db.preventivo?.stato).toBe('accettato');
    expect(db.preventivo?.fascia_scelta).toBe('premium');
  });

  it('con un altro account già dentro, la sua sessione non si tocca: si entra dall email', async () => {
    db.sessione!.altro = true;
    const r = await conferma(BUONO);
    const corpo = await r.json();
    expect(corpo.data.entra).toBeNull();
    expect(corpo.data.accessoInviato).toBe(true);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(db.sessione!.gettoni).toEqual([]);
    expect(db.link).toHaveLength(1);
    expect(db.preventivo?.stato).toBe('accettato');
  });

  it('se il gettone non apre la sessione, la conferma resta e l email parte', async () => {
    db.sessione!.entra = false;
    const r = await conferma(BUONO);
    const corpo = await r.json();
    expect(corpo.ok).toBe(true);
    expect(corpo.data.entra).toBeNull();
    expect(corpo.data.accessoInviato).toBe(true);
    expect(db.preventivo?.stato).toBe('accettato');
  });

  it('senza le chiavi pubbliche di Supabase la conferma resta, senza sessione', async () => {
    db.sessione = null;
    const r = await conferma(BUONO);
    const corpo = await r.json();
    expect(corpo.ok).toBe(true);
    expect(corpo.data.entra).toBeNull();
    expect(db.link).toHaveLength(1);
  });

  it('una richiesta da un altro sito è rifiutata e il preventivo resta aperto', async () => {
    const r = await conferma(BUONO, { origin: 'https://altro-sito.example' });
    expect(r.status).toBe(403);
    expect(db.preventivo?.stato).toBe('aperto');
    expect(db.link).toHaveLength(0);
  });

  it('Origin «null» (pagina in un riquadro protetto) è rifiutata (collaudo M2)', async () => {
    const r = await conferma(BUONO, { origin: 'null' });
    expect(r.status).toBe(403);
    expect(db.preventivo?.stato).toBe('aperto');
  });

  it('un corpo che non è JSON dichiarato (un modulo text/plain) è rifiutato (collaudo M3)', async () => {
    const r = await conferma(BUONO, { 'content-type': 'text/plain' });
    expect(r.status).toBe(400);
    expect(db.preventivo?.stato).toBe('aperto');
    expect(db.link).toHaveLength(0);
  });

  it('dal sito stesso passa', async () => {
    const r = await conferma(BUONO, { origin: 'https://mycity.example' });
    expect(r.status).toBe(200);
  });
});
