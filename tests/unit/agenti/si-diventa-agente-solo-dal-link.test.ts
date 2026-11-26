// Gli agenti dentro MyCity — secondo e terzo collaudo del 26/11/2026. Queste prove diventano rosse se torna uno
// dei difetti trovati: un account creato dal link con un'email non verificata, il «sì» alle condizioni non messo
// a verbale, il posto del link perso quando l'attivazione si ferma, l'agente sospeso che si riattiva da solo,
// il codice nell'indirizzo, il freno per link tolto, Admin che dice «fatto» senza aver toccato niente.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

type Voce = [string, ...unknown[]];
const registro: Voce[] = [];
const FUTURO = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
let invito: Record<string, unknown> | null;
let erroreAgenti: { code?: string; message: string } | null;
let rigaAgente: { attivo: boolean; sospeso_il: string | null } | null;
let rigaVerbale: { versione_testo: string } | null;
let righeAggiornate: unknown[];
let frenoPerLinkChiuso: boolean;

function catena(tabella: string) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'order', 'limit']) q[m] = () => q;
  q.maybeSingle = async () => ({
    data: tabella === 'inviti_agente' ? invito : tabella === 'agenti' ? rigaAgente : tabella === 'consent_log' ? rigaVerbale : null,
    error: null,
  });
  q.insert = (riga: Record<string, unknown>) => {
    registro.push(['insert', tabella, riga]);
    return Promise.resolve({ error: tabella === 'agenti' ? erroreAgenti : null });
  };
  q.update = (riga: Record<string, unknown>) => {
    registro.push(['update', tabella, riga]);
    return q;
  };
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve({ data: righeAggiornate, error: null }).then(ok, ko);
  return q;
}

const admin = {
  from: (t: string) => catena(t),
  rpc: async (nome: string, args: unknown) => {
    registro.push(['rpc', nome, args]);
    return { data: nome === 'usa_invito_agente' ? 'invito-1' : null, error: null };
  },
  auth: { admin: { createUser: async (a: { email: string }) => { registro.push(['createUser', a.email]); return { data: { user: { id: 'x' } }, error: null }; } } },
};

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => admin, getServerSupabase: async () => ({}) }));
vi.mock('@/lib/rate-limit', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/lib/rate-limit')),
  getClientIp: () => '203.0.113.7',
  rateLimitAsync: async ({ key }: { key: string }) => ({ allowed: !(frenoPerLinkChiuso && key.startsWith('invito-agente-link:')), retryAfterSec: 60 }),
}));
// L'accesso lo controllano gli involucri veri altrove: qui conta cosa fa la rotta con chi è già dentro.
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, gestore: (c: unknown) => Promise<Response>) => (req: Request) =>
    gestore({ user: { id: 'utente-1', email: 'Agente@Esempio.it' }, profile: { role: 'customer' }, req, params: {} }),
  withAdminAuth: (gestore: (c: unknown) => Promise<Response>) => (req: Request) =>
    gestore({ user: { id: 'admin-1' }, profile: { role: 'admin' }, req, params: {} }),
}));

process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.test';

const { POST: attiva } = await import('@/app/api/invito-agente/attiva/route');
const { PATCH: modificaAdmin } = await import('@/app/api/admin/agenti/route');
const { AgenteSospeso, faiAgente, linkInvito, nuovoCodice } = await import('@/lib/agenti/inviti');
const { VERSIONE_TESTI_LEGALI } = await import('@/lib/legal/versione');

const CODICE = nuovoCodice();
const post = (indirizzo: string, corpo: unknown, metodo = 'POST') =>
  new Request(`https://mycity.test${indirizzo}`, { method: metodo, headers: { 'content-type': 'application/json', 'user-agent': 'telefono-di-prova' }, body: JSON.stringify(corpo) });
const premiAttiva = (corpo: unknown = { codice: CODICE, accettoCondizioni: true }) => attiva(post('/api/invito-agente/attiva', corpo) as never);
const trova = (tipo: string, cosa: string) => registro.filter((v) => v[0] === tipo && v[1] === cosa);

beforeEach(() => {
  registro.length = 0;
  invito = { id: 'invito-1', nota: null, creato_il: '2026-11-26T20:00:00Z', scade_il: FUTURO, usi_max: 1, usi: 0, ritirato_il: null };
  erroreAgenti = null;
  rigaAgente = null;
  rigaVerbale = null;
  righeAggiornate = [{ id: 'riga' }];
  frenoPerLinkChiuso = false;
});

describe('il link d’invito', () => {
  it('porta il codice dopo il «#», così non finisce nei registri del server', () => {
    const link = linkInvito(CODICE);
    expect(link).toBe(`https://mycity.test/invito-agente#${CODICE}`);
    expect(new URL(link).pathname).toBe('/invito-agente');
  });

  it('nessuna rotta del link crea un account: l’email la conferma la registrazione normale', async () => {
    const cartella = path.resolve(__dirname, '..', '..', '..', 'app', 'api', 'invito-agente');
    const rotte = fs.readdirSync(cartella, { recursive: true }).map(String).filter((f) => f.endsWith('route.ts'));
    expect(rotte.length).toBeGreaterThan(0);
    for (const f of rotte) {
      const modulo = (await import(path.join(cartella, f))) as { POST?: (r: Request) => Promise<Response> };
      if (!modulo.POST) continue;
      await modulo.POST(post(`/api/invito-agente/${f}`, { codice: CODICE, email: 'vittima@esempio.it', password: 'una-password-lunga', accettoCondizioni: true }));
    }
    expect(trova('createUser', 'vittima@esempio.it')).toHaveLength(0);
  });
});

describe('«Attiva»: account MyCity + link valido = agente', () => {
  it('scrive la riga di agente e mette a verbale il «sì», con versione, rete e browser', async () => {
    const r = await premiAttiva();
    expect(r.status).toBe(200);
    expect(trova('insert', 'agenti')[0]?.[2]).toMatchObject({ user_id: 'utente-1', email: 'agente@esempio.it', invito_id: 'invito-1', attivo: true });
    expect(trova('insert', 'consent_log')[0]?.[2]).toMatchObject({ user_id: 'utente-1', categoria: 'privacy_terms', valore: true, versione_testo: VERSIONE_TESTI_LEGALI.slice(0, 60), ip: '203.0.113.7', user_agent: 'telefono-di-prova' });
    expect(trova('update', 'profiles')[0]?.[2]).toHaveProperty('tos_accepted_at');
  });

  it('non riscrive il verbale se la versione in vigore è già accettata', async () => {
    rigaVerbale = { versione_testo: VERSIONE_TESTI_LEGALI };
    expect((await premiAttiva()).status).toBe(200);
    expect(trova('insert', 'consent_log')).toHaveLength(0);
  });

  it('senza la spunta sulle condizioni non parte, e il link non si consuma', async () => {
    expect((await premiAttiva({ codice: CODICE })).status).toBe(400);
    expect(trova('rpc', 'usa_invito_agente')).toHaveLength(0);
  });

  it('se la riga di agente non si scrive, il posto del link torna libero', async () => {
    erroreAgenti = { code: '57014', message: 'tempo scaduto' };
    expect((await premiAttiva()).status).toBe(503);
    expect(trova('rpc', 'restituisci_invito_agente')).toEqual([['rpc', 'restituisci_invito_agente', { p_id: 'invito-1' }]]);
  });

  it('il freno per link ferma i tentativi prima di toccare il link', async () => {
    frenoPerLinkChiuso = true;
    expect((await premiAttiva()).status).toBe(429);
    expect(trova('rpc', 'usa_invito_agente')).toHaveLength(0);
  });
});

describe('l’agente sospeso resta sospeso', () => {
  it('faiAgente non riattiva una riga sospesa', async () => {
    erroreAgenti = { code: '23505', message: 'duplicate key value violates unique constraint "agenti_pkey"' };
    rigaAgente = { attivo: false, sospeso_il: '2026-11-26T21:00:00Z' };
    await expect(faiAgente({ userId: 'x', email: 'x@esempio.it', invitoId: 'invito-1' })).rejects.toBeInstanceOf(AgenteSospeso);
    expect(trova('update', 'agenti')).toHaveLength(0);
    rigaAgente = { attivo: true, sospeso_il: null };
    await expect(faiAgente({ userId: 'x', email: 'x@esempio.it', invitoId: 'invito-1' })).resolves.toBeUndefined();
  });

  it('«Attiva» con un link valido non riapre un agente sospeso, e non consuma il link', async () => {
    rigaAgente = { attivo: false, sospeso_il: '2026-11-26T21:00:00Z' };
    expect((await premiAttiva()).status).toBe(409);
    expect(trova('rpc', 'usa_invito_agente')).toHaveLength(0);
  });
});

describe('Admin → Agenti', () => {
  it('se la modifica non tocca nessuna riga, non risponde «fatto»', async () => {
    righeAggiornate = [];
    const r = await modificaAdmin(post('/api/admin/agenti', { azione: 'ritira', id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427' }, 'PATCH') as never);
    expect(r.status).toBe(409);
    righeAggiornate = [{ id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427' }];
    const ok = await modificaAdmin(post('/api/admin/agenti', { azione: 'ritira', id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427' }, 'PATCH') as never);
    expect(ok.status).toBe(200);
  });
});
