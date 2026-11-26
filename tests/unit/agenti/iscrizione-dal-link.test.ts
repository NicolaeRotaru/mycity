// Gli agenti dentro MyCity — il secondo collaudo del 26/11/2026. Queste prove diventano rosse se torna uno dei
// difetti trovati: il «sì» alle condizioni non messo a verbale, il posto del link perso quando l'iscrizione si
// ferma a metà, l'agente sospeso che si riattiva da solo con un link nuovo, il codice nell'indirizzo, l'errore
// della password detto come un guasto.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Voce = [string, ...unknown[]];
const registro: Voce[] = [];
const FUTURO = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
let invito: Record<string, unknown> | null;
let utenteCreato: { data: { user: { id: string } | null }; error: { message: string } | null };
let erroreAgenti: { code?: string; message: string } | null;
let rigaAgente: { attivo: boolean; sospeso_il: string | null } | null;

function catena(tabella: string) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'order', 'limit']) q[m] = () => q;
  q.maybeSingle = async () => ({ data: tabella === 'inviti_agente' ? invito : tabella === 'agenti' ? rigaAgente : null, error: null });
  q.insert = (riga: Record<string, unknown>) => {
    registro.push(['insert', tabella, riga]);
    return Promise.resolve({ error: tabella === 'agenti' ? erroreAgenti : null });
  };
  q.update = (riga: Record<string, unknown>) => {
    registro.push(['update', tabella, riga]);
    return q;
  };
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok, ko);
  return q;
}

const admin = {
  from: (t: string) => catena(t),
  rpc: async (nome: string, args: unknown) => {
    registro.push(['rpc', nome, args]);
    return { data: nome === 'usa_invito_agente' ? 'invito-1' : null, error: null };
  },
  auth: { admin: { createUser: async (a: { email: string }) => { registro.push(['createUser', a.email]); return utenteCreato; } } },
};

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => admin, getServerSupabase: async () => ({}) }));
vi.mock('@/lib/rate-limit', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/lib/rate-limit')),
  getClientIp: () => '203.0.113.7',
  rateLimitAsync: async () => ({ allowed: true }),
}));
// L'accesso lo controlla l'involucro vero altrove: qui conta cosa fa la rotta con un utente già collegato.
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, gestore: (c: unknown) => Promise<Response>) => (req: Request) =>
    gestore({ user: { id: 'utente-gia-iscritto', email: 'gia@esempio.it' }, profile: { role: 'customer' }, req, params: {} }),
}));

process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.test';

const { POST: iscriviti } = await import('@/app/api/invito-agente/iscriviti/route');
const { POST: attiva } = await import('@/app/api/invito-agente/attiva/route');
const { AgenteSospeso, faiAgente, linkInvito, nuovoCodice } = await import('@/lib/agenti/inviti');
const { VERSIONE_TESTI_LEGALI } = await import('@/lib/legal/versione');

const CODICE = nuovoCodice();
const richiesta = (corpo: unknown) =>
  new Request('https://mycity.test/api/invito-agente/iscriviti', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'telefono-di-prova' }, body: JSON.stringify(corpo) });
const corpoGiusto = { codice: CODICE, email: 'Agente@Esempio.it', password: 'una-password-lunga', accettoCondizioni: true };
const trova = (tipo: string, cosa: string) => registro.filter((v) => v[0] === tipo && v[1] === cosa);

beforeEach(() => {
  registro.length = 0;
  invito = { id: 'invito-1', nota: null, creato_il: '2026-11-26T20:00:00Z', scade_il: FUTURO, usi_max: 1, usi: 0, ritirato_il: null };
  utenteCreato = { data: { user: { id: 'nuovo-agente' } }, error: null };
  erroreAgenti = null;
  rigaAgente = null;
});

describe('l’agente si iscrive dal link', () => {
  it('il link porta il codice dopo il «#», così non finisce nei registri del server', () => {
    const link = linkInvito(CODICE);
    expect(link).toBe(`https://mycity.test/invito-agente#${CODICE}`);
    expect(new URL(link).pathname).toBe('/invito-agente');
  });

  it('il «sì» alle condizioni va a verbale, con versione, rete e browser, e la data nel profilo', async () => {
    const r = await iscriviti(richiesta(corpoGiusto));
    expect(r.status).toBe(201);
    const [verbale] = trova('insert', 'consent_log');
    expect(verbale?.[2]).toMatchObject({ user_id: 'nuovo-agente', categoria: 'privacy_terms', valore: true, versione_testo: VERSIONE_TESTI_LEGALI.slice(0, 60), ip: '203.0.113.7', user_agent: 'telefono-di-prova' });
    expect(trova('update', 'profiles')[0]?.[2]).toHaveProperty('tos_accepted_at');
    expect(trova('insert', 'agenti')[0]?.[2]).toMatchObject({ user_id: 'nuovo-agente', email: 'agente@esempio.it', invito_id: 'invito-1', attivo: true });
    expect(trova('rpc', 'restituisci_invito_agente')).toHaveLength(0);
  });

  it('una password rubata o debole è un errore da correggere (400, in italiano), e il posto del link torna libero', async () => {
    utenteCreato = { data: { user: null }, error: { message: 'Password is known to be weak and easy to guess, please choose a different one.' } };
    const r = await iscriviti(richiesta(corpoGiusto));
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).not.toMatch(/weak|guess/i);
    expect(trova('rpc', 'restituisci_invito_agente')).toEqual([['rpc', 'restituisci_invito_agente', { p_id: 'invito-1' }]]);
  });

  it('se la riga di agente non si scrive, il posto del link torna libero (la persona poi preme «Attiva»)', async () => {
    erroreAgenti = { code: '57014', message: 'tempo scaduto' };
    const r = await iscriviti(richiesta(corpoGiusto));
    expect(r.status).toBe(503);
    expect(trova('rpc', 'restituisci_invito_agente')).toHaveLength(1);
  });

  it('il codice nell’indirizzo non serve più: senza codice nel corpo non si entra', async () => {
    const r = await iscriviti(richiesta({ ...corpoGiusto, codice: undefined }));
    expect(r.status).toBe(400);
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
    const r = await attiva(new Request('https://mycity.test/api/invito-agente/attiva', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codice: CODICE }) }) as never);
    expect(r.status).toBe(409);
    expect(trova('rpc', 'usa_invito_agente')).toHaveLength(0);
  });
});
