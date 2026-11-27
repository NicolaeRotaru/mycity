import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nuovoDb, supabaseFinto, type DbFinto } from '../agenzia/_supabase-finto';

/**
 * CHI HA IL LINK DEL PREVENTIVO NON ENTRA NELLE PAGINE DEGLI AGENTI NÉ IN QUELLA DI SDG — 27/11/2026.
 *
 * La variante scomoda del collaudo della sicurezza: il titolare che ha confermato dal link entra col suo account di
 * negozio (il suo id è il seller_id dell'ordine). Qui la porta degli agenti è quella VERA (lib/agenti/rotta.ts e
 * lib/agenti/inviti.ts, non finte): il titolare riceve 403 su /api/agente/attivita, /api/agente/schede e su GET e
 * POST /api/sdg/ordini, e l'ordine resta com'era. Il collaudo ha mostrato che senza queste prove si potevano
 * togliere la guardia del POST degli ordini o la porta degli agenti e restava tutto verde.
 */
const SELLER = '0de1905e-7000-4000-8000-0000000000aa';
const LAVORO = '11111111-2222-4333-8444-555555555555';

const stato = vi.hoisted(() => ({
  db: null as unknown as DbFinto,
  chi: null as null | { email: string; role: string; id: string },
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://www.mycity-marketplace.com' } }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => supabaseFinto(stato.db) }));
vi.mock('@/lib/agenti/n8n', () => ({ elencoSchede: async () => [], leggiLavoro: async () => ({ stato: 'sconosciuto' }), avviaLavoro: async () => ({ ok: false }), adCollegato: () => false }));
vi.mock('@/lib/api/middleware', () => {
  const porta = (gestore: (c: Record<string, unknown>) => unknown) => async (req: Request) => {
    if (!stato.chi) return new Response('{}', { status: 401 });
    return gestore({ req, user: { id: stato.chi.id, email: stato.chi.email }, profile: { role: stato.chi.role } });
  };
  return { withAuth: porta, withAuthRateLimit: (_o: unknown, g: (c: Record<string, unknown>) => unknown) => porta(g) };
});

const attivita = (await import('@/app/api/agente/attivita/route')).GET as unknown as (r: Request) => Promise<Response>;
const schede = (await import('@/app/api/agente/schede/route')).GET as unknown as (r: Request) => Promise<Response>;
const ordiniGet = (await import('@/app/api/sdg/ordini/route')).GET as unknown as (r: Request) => Promise<Response>;
const ordiniPost = (await import('@/app/api/sdg/ordini/route')).POST as unknown as (r: Request) => Promise<Response>;

beforeEach(() => {
  const db: DbFinto = nuovoDb();
  db.tabelle.profiles = [{ id: SELLER, store_name: 'Caffè di Prova' }];
  db.tabelle.agenti = [
    { user_id: 'u-anna', email: 'anna@esempio.it', attivo: true },
    { user_id: 'u-sospeso', email: 'sospeso@esempio.it', attivo: false },
  ];
  db.tabelle.preventivi_con_codice = [
    { seller_id: SELLER, codice: 'a'.repeat(64), stato: 'accettato', fascia_scelta: 'business', creato_il: '2026-11-27T10:00:00Z', accettato_il: '2026-11-27T16:25:00Z', lavoro: LAVORO, agente_email: 'anna@esempio.it' },
  ];
  db.tabelle.ordini_sdg = [{ id: '00000000-0000-4000-8000-0000000000f1', seller_id: SELLER, nome_attivita: 'Caffè di Prova', fascia: 'business', agente_email: 'anna@esempio.it', piano_origine: 'sito', piano_completo_stato: 'errore', piano: { contenuti: [] }, dati_attivita: {}, creato_il: 'x', aggiornato_il: 'x' }];
  stato.db = db;
});

describe('il titolare entrato e chi ha il link restano fuori', () => {
  it('il titolare (seller, uid = seller_id dell ordine) non entra in /api/agente/* né in /api/sdg/ordini', async () => {
    stato.chi = { email: 'titolare@esempio.it', role: 'seller', id: SELLER };
    const r1 = await attivita(new Request(`http://x/api/agente/attivita?lavoro=${LAVORO}`));
    expect(r1.status).toBe(403);
    expect(await r1.text()).not.toContain('Caffè di Prova');
    const r2 = await schede(new Request('http://x/api/agente/schede'));
    expect(r2.status).toBe(403);
    expect((await ordiniGet(new Request('http://x/api/sdg/ordini'))).status).toBe(403);
    const r4 = await ordiniPost(new Request('http://x/api/sdg/ordini', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: '00000000-0000-4000-8000-0000000000f1', azione: 'chiedi-piano' }) }));
    expect(r4.status).toBe(403);
    expect(stato.db.tabelle.ordini_sdg[0].piano_completo_stato).toBe('errore');
  });

  it('il titolare con la stessa email dell agente (non succede, ma) resta fuori perché non è agente', async () => {
    stato.chi = { email: 'anna@esempio.it', role: 'seller', id: SELLER };
    expect((await attivita(new Request(`http://x/api/agente/attivita?lavoro=${LAVORO}`))).status).toBe(403);
  });

  it('un agente sospeso, anche se è lui che l ha portata, non legge', async () => {
    stato.db.tabelle.preventivi_con_codice[0].agente_email = 'sospeso@esempio.it';
    stato.chi = { email: 'sospeso@esempio.it', role: 'seller', id: 'u-sospeso' };
    expect((await attivita(new Request(`http://x/api/agente/attivita?lavoro=${LAVORO}`))).status).toBe(403);
  });

  it('l agente attivo che l ha portata legge (la porta vera non chiude tutto)', async () => {
    stato.chi = { email: 'Anna@Esempio.it', role: 'seller', id: 'u-anna' };
    const r = await attivita(new Request(`http://x/api/agente/attivita?lavoro=${LAVORO}`));
    expect(r.status).toBe(200);
  });
});
