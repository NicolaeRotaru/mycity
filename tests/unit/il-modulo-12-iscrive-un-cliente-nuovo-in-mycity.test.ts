import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 25/11/2026 — IL MODULO 12 ISCRIVE UN CLIENTE NUOVO IN MYCITY.
 *
 * Nicola: «modifica il modulo 12 e permetti di iscrivere un nuovo cliente dentro mycity», «come Ora del
 * Gusto»: senza accesso, fuori vetrina, col link col codice. Queste prove diventano rosse se la porta si
 * apre senza segreto, se il negozio nasce approvato o visibile, se due invii creano due negozi, o se il
 * modulo riscrive un'attività che ha già accettato.
 */

const db = vi.hoisted(() => ({
  utenti: new Map<string, { id: string; email: string }>(),
  profili: new Map<string, Record<string, unknown>>(),
  link: new Map<string, { seller_id: string; codice: string }>(),
  creaUtente: [] as Array<Record<string, unknown>>,
  ultimoId: 0,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfterSec: 0, limit: 20 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    auth: {
      admin: {
        createUser: async (o: { email: string } & Record<string, unknown>) => {
          db.creaUtente.push(o);
          if ([...db.utenti.values()].some((u) => u.email === o.email)) return { data: { user: null }, error: { message: 'already registered' } };
          db.ultimoId += 1;
          const id = `00000000-0000-4000-8000-${String(db.ultimoId).padStart(12, '0')}`;
          db.utenti.set(id, { id, email: o.email });
          db.profili.set(id, { id, role: 'pending_approval' });
          return { data: { user: { id } }, error: null };
        },
        getUserById: async (id: string) => ({ data: { user: db.utenti.get(id) ?? null }, error: null }),
      },
    },
    from: (tabella: string) => {
      const filtri: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        select: () => q,
        limit: () => q,
        eq: (c: string, v: unknown) => { filtri[c] = v; return q; },
        maybeSingle: async () => ({ data: tabella === 'profiles' ? db.profili.get(String(filtri.id)) ?? null : null, error: null }),
        upsert: async (riga: Record<string, unknown>, o?: { ignoreDuplicates?: boolean }) => {
          if (tabella === 'profiles') db.profili.set(String(riga.id), { ...db.profili.get(String(riga.id)), ...riga });
          if (tabella === 'preventivi_con_codice' && !(o?.ignoreDuplicates && db.link.has(String(riga.seller_id))))
            db.link.set(String(riga.seller_id), riga as { seller_id: string; codice: string });
          return { error: null };
        },
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
          const nome = filtri['profiles.store_name'];
          const righe = [...db.link.values()].filter((l) => db.profili.get(l.seller_id)?.store_name === nome);
          return Promise.resolve({ data: righe, error: null }).then(ok, ko);
        },
      };
      return q;
    },
  }),
}));

const SEGRETO = 'segreto-di-prova-1234567890';
const chiama = async (corpo: unknown, segreto: string | null = SEGRETO) => {
  const { POST } = await import('@/app/api/agenzia/nuova-attivita/route');
  const h: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-proto': 'https' };
  if (segreto) h['x-mycity-segreto'] = segreto;
  return POST(new Request('https://www.mycity-marketplace.com/api/agenzia/nuova-attivita', { method: 'POST', headers: h, body: JSON.stringify(corpo) }));
};
const BAR = { tipo: 'nuova-attivita', nome: 'Bar Prova', tipo_attivita: 'bar', citta: 'Piacenza', indirizzo: 'Via Roma 1' };

beforeEach(() => {
  db.utenti.clear(); db.profili.clear(); db.link.clear(); db.creaUtente.length = 0; db.ultimoId = 0;
  process.env.N8N_SCHEDA_CLIENTE_SEGRETO = SEGRETO;
});

describe('la porta del modulo 12', () => {
  it('senza segreto configurato resta chiusa', async () => {
    delete process.env.N8N_SCHEDA_CLIENTE_SEGRETO;
    expect((await chiama(BAR)).status).toBe(503);
  });
  it('col segreto sbagliato non iscrive niente', async () => {
    expect((await chiama(BAR, 'sbagliato')).status).toBe(401);
    expect(db.creaUtente).toHaveLength(0);
  });
  it('rifiuta un corpo senza nome', async () => {
    expect((await chiama({ tipo: 'nuova-attivita', nome: '' })).status).toBe(400);
  });
});

describe('il negozio nasce come Ora del Gusto', () => {
  it('senza accesso, con email finta, venditore non approvato, fuori vetrina e col link', async () => {
    const r = await chiama(BAR);
    expect(r.status).toBe(201);
    const { id_attivita } = (await r.json()) as { id_attivita: string };
    const u = db.creaUtente[0];
    expect(String(u.email)).toMatch(/\.preventivo@mycity-system\.local$/);
    expect(u.ban_duration).toBeTruthy();
    const p = db.profili.get(id_attivita)!;
    expect(p).toMatchObject({ role: 'seller', is_approved: false, approval_status: null, store_name: 'Bar Prova', business_type: 'bar' });
    expect(p.store_address).toBe('Via Roma 1, Piacenza');
    expect(db.link.get(id_attivita)?.codice).toMatch(/^[0-9a-f]{64}$/);
  });

  // 25/11/2026 — Nicola: l'analisi parte subito, da tutte e due le porte. Chi nasce dal modulo 12 va
  // anche al flusso 16, come chi si iscrive da /sell. Una seconda volta (stesso negozio) no.
  it('un negozio nuovo va anche al flusso 16; lo stesso negozio rimandato no', async () => {
    const chiamate: Array<{ url: string; corpo: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { chiamate.push({ url, corpo: JSON.parse(String(init.body)) }); return new Response('{}', { status: 200 }); }));
    process.env.N8N_NUOVO_CLIENTE_WEBHOOK_URL = 'https://n8n.example/webhook/mycity-nuovo-cliente';
    process.env.N8N_NUOVO_CLIENTE_SEGRETO = 'segreto-16';
    try {
      const { id_attivita } = (await (await chiama(BAR)).json()) as { id_attivita: string };
      await vi.waitFor(() => expect(chiamate).toHaveLength(1));
      expect(chiamate[0].url).toBe('https://n8n.example/webhook/mycity-nuovo-cliente');
      expect(chiamate[0].corpo).toMatchObject({ tipo: 'nuovo-cliente', provenienza: 'modulo-12', attivita: { id: id_attivita, nome: 'Bar Prova', tipo: 'bar', citta: 'Piacenza' } });
      expect((await chiama(BAR)).status).toBe(200);
      await new Promise((r) => setTimeout(r, 20));
      expect(chiamate).toHaveLength(1);
    } finally {
      delete process.env.N8N_NUOVO_CLIENTE_WEBHOOK_URL;
      delete process.env.N8N_NUOVO_CLIENTE_SEGRETO;
      vi.unstubAllGlobals();
    }
  });

  it('lo stesso nome e città mandati due volte non creano due negozi né cambiano il link', async () => {
    const a = (await (await chiama(BAR)).json()) as { id_attivita: string };
    const codice = db.link.get(a.id_attivita)!.codice;
    const r = await chiama(BAR);
    expect(r.status).toBe(200);
    const b = (await r.json()) as { id_attivita: string; nuova: boolean };
    expect(b).toMatchObject({ id_attivita: a.id_attivita, nuova: false });
    expect(db.utenti.size).toBe(1);
    expect(db.link.get(a.id_attivita)!.codice).toBe(codice);
  });

  it('col sito pubblico lo scrive nei canali della vetrina; un indirizzo non https lo scarta', async () => {
    const a = (await (await chiama({ ...BAR, sito: 'https://www.barprova.it/' })).json()) as { id_attivita: string };
    expect(db.profili.get(a.id_attivita)!.store_customization).toEqual({ socials: { website: 'https://www.barprova.it/' } });
    const b = (await (await chiama({ ...BAR, nome: 'Bar Due', sito: 'http://127.0.0.1/' })).json()) as { id_attivita: string };
    expect(db.profili.get(b.id_attivita)!.store_customization).toBeUndefined();
  });

  it('non riscrive un’attività che ha già accettato', async () => {
    const a = (await (await chiama(BAR)).json()) as { id_attivita: string };
    db.profili.set(a.id_attivita, { ...db.profili.get(a.id_attivita), approval_status: 'approved', is_approved: true });
    const r = await chiama({ ...BAR, tipo_attivita: 'negozio' });
    expect(r.status).toBe(409);
    expect(db.profili.get(a.id_attivita)!.business_type).toBe('bar');
  });
});
