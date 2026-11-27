import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nuovoDb, supabaseFinto, type DbFinto } from '../agenzia/_supabase-finto';

/**
 * ④ UN AGENTE VEDE SOLO LE SUE ATTIVITÀ, L'ADMIN TUTTE — 27/11/2026.
 *
 * Dopo il «Sì, aggiungi» la pagina dell'agente chiede a /api/agente/attivita se il titolare ha confermato, e la pagina
 * «Adesso tocca a SDG» ci legge i passi. Un agente vede solo le attività che ha portato lui (agente_email sul
 * preventivo, migrazione 999c); l'admin tutte, come /api/agente/stato. Quello che non è suo risponde 404, come quello
 * che non c'è. E gli ordini di SDG (/api/sdg/ordini) li leggono solo l'admin e l'account di SDG: non il titolare, non
 * un altro negozio, non un agente, non chi ha solo il link del preventivo.
 */

const SELLER = '0de1905e-7000-4000-8000-0000000000aa';
const ALTRO = '0de1905e-7000-4000-8000-0000000000bb';
const LAVORO = '11111111-2222-4333-8444-555555555555';
const LAVORO_ALTRO = '11111111-2222-4333-8444-666666666666';
const SDG = '11111111-1111-1111-1111-5d9000000001';

const stato = vi.hoisted(() => ({
  db: null as unknown as DbFinto,
  chi: { email: 'anna@esempio.it', role: 'seller' as string, id: 'u-anna' } as null | { email: string; role: string; id: string },
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://www.mycity-marketplace.com' } }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => supabaseFinto(stato.db) }));
vi.mock('@/lib/agenti/n8n', () => ({ elencoSchede: async () => [], leggiLavoro: async () => ({ stato: 'sconosciuto' }), avviaLavoro: async () => ({ ok: false }), adCollegato: () => false }));
// La porta degli agenti (lib/agenti/rotta.ts) la prova si-diventa-agente-solo-dal-link: qui c'è l'agente già entrato.
vi.mock('@/lib/agenti/rotta', () => ({
  conAgente: (_f: unknown, gestore: (c: Record<string, unknown>) => unknown) => (req: Request) =>
    gestore({ req, email: stato.chi!.email, profile: { role: stato.chi!.role }, user: { id: stato.chi!.id } }),
}));
// La porta degli ordini di SDG: chi ha solo il link del preventivo non ha un accesso, e withAuth risponde 401.
vi.mock('@/lib/api/middleware', () => {
  const porta = (gestore: (c: Record<string, unknown>) => unknown) => async (req: Request) => {
    if (!stato.chi) return new Response(JSON.stringify({ ok: false, error: { message: 'Non autenticato' } }), { status: 401 });
    return gestore({ req, user: { id: stato.chi.id }, profile: { role: stato.chi.role } });
  };
  return { withAuth: porta, withAuthRateLimit: (_o: unknown, g: (c: Record<string, unknown>) => unknown) => porta(g) };
});

const attivita = (await import('@/app/api/agente/attivita/route')).GET as unknown as (r: Request) => Promise<Response>;
const schede = (await import('@/app/api/agente/schede/route')).GET as unknown as (r: Request) => Promise<Response>;
const ordiniSdg = (await import('@/app/api/sdg/ordini/route')).GET as unknown as (r: Request) => Promise<Response>;

const chiedi = (lavoro: string) => attivita(new Request(`http://localhost/api/agente/attivita?lavoro=${lavoro}`));
const corpo = async (r: Response) => (await r.json()) as { ok: boolean; data: Record<string, unknown>; error?: { message: string } };

beforeEach(() => {
  const db = nuovoDb();
  db.tabelle.profiles = [
    { id: SELLER, store_name: 'Caffè di Prova' },
    { id: ALTRO, store_name: 'Forno di Bruno' },
  ];
  db.tabelle.preventivi_con_codice = [
    { seller_id: SELLER, codice: 'a'.repeat(64), stato: 'accettato', fascia_scelta: 'business', creato_il: '2026-11-27T10:00:00Z', accettato_il: '2026-11-27T16:25:00Z', lavoro: LAVORO, agente_email: 'anna@esempio.it', visita_il: '2026-12-03T09:00:00.000Z' },
    { seller_id: ALTRO, codice: 'd'.repeat(64), stato: 'aperto', fascia_scelta: 'base', creato_il: '2026-11-27T11:00:00Z', accettato_il: null, lavoro: LAVORO_ALTRO, agente_email: 'bruno@esempio.it' },
  ];
  db.tabelle.ordini_sdg = [{
    id: 'o-1', seller_id: SELLER, nome_attivita: 'Caffè di Prova', fascia: 'business', canone_centesimi: 50000, primo_mese_centesimi: 25000,
    visita_il: '2026-12-03T09:00:00.000Z', agente_email: 'anna@esempio.it', piano_origine: 'sito', piano_completo_stato: 'da_collegare',
    piano: { periodo: { titolo: 'dal 7 dicembre 2026 al 3 gennaio 2027' }, contenuti: new Array(12).fill({}) }, dati_attivita: { tipo: 'bar' },
    creato_il: '2026-11-27T16:25:01Z', aggiornato_il: '2026-11-27T16:25:01Z',
  }];
  stato.db = db;
  stato.chi = { email: 'anna@esempio.it', role: 'seller', id: 'u-anna' };
});

describe('④ /api/agente/attivita: ogni agente le sue, l admin tutte', () => {
  it('l agente che l ha portata vede l attività confermata, coi passi di SDG e la visita', async () => {
    const r = await chiedi(LAVORO);
    expect(r.status).toBe(200);
    const d = (await corpo(r)).data as { stato: string; nome: string; fascia: string; visita: string; link: string | null; passi: { titolo: string; testo: string }[] };
    expect(d).toMatchObject({ stato: 'accettato', nome: 'Caffè di Prova', fascia: 'business', visita: 'Visita: giovedì 3 dicembre alle 10:00', link: null });
    expect(d.passi.map((p) => p.titolo)).toEqual(['La visita del team creativo', 'Le prime foto e i primi video', 'Il piano editoriale del primo mese', 'Il sito', 'I contanti, al primo servizio']);
    expect(d.passi[0].testo).toContain('giovedì 3 dicembre alle 10:00');
    expect(d.passi[4].testo).toContain('250 €');
    expect(d.passi[4].testo).toContain('500 €');
  });

  it('un altro agente non la vede: 404, come una che non c è', async () => {
    stato.chi = { email: 'bruno@esempio.it', role: 'seller', id: 'u-bruno' };
    const r = await chiedi(LAVORO);
    expect(r.status).toBe(404);
    expect(JSON.stringify(await corpo(r))).not.toContain('Caffè di Prova');
    // La sua invece sì, ancora aperta, col link da rimandare.
    const sua = await corpo(await chiedi(LAVORO_ALTRO));
    expect(sua.data).toMatchObject({ stato: 'aperto', nome: 'Forno di Bruno', link: `https://www.mycity-marketplace.com/preventivo/${'d'.repeat(64)}`, passi: [] });
  });

  it('l admin le vede tutte', async () => {
    stato.chi = { email: 'nicola@esempio.it', role: 'admin', id: 'u-nicola' };
    expect((await chiedi(LAVORO)).status).toBe(200);
    expect((await chiedi(LAVORO_ALTRO)).status).toBe(200);
  });

  it('un codice storto o sconosciuto non legge niente', async () => {
    expect((await chiedi('non-un-codice')).status).toBe(400);
    expect((await chiedi('99999999-2222-4333-8444-555555555555')).status).toBe(404);
  });

  it('l email dell agente scritta sul preventivo, non quella del lavoro su n8n, decide: senza agente_email nessun agente la vede', async () => {
    stato.db.tabelle.preventivi_con_codice[0].agente_email = null;
    expect((await chiedi(LAVORO)).status).toBe(404);
  });

  it('l elenco «Hanno confermato» ha solo le attività confermate portate da quell agente', async () => {
    const d = (await corpo(await schede(new Request('http://localhost/api/agente/schede')))).data as { confermate: { lavoro: string; nome: string }[] };
    expect(d.confermate).toEqual([{ lavoro: LAVORO, nome: 'Caffè di Prova' }]);
    stato.chi = { email: 'bruno@esempio.it', role: 'seller', id: 'u-bruno' };
    const b = (await corpo(await schede(new Request('http://localhost/api/agente/schede')))).data as { confermate: unknown[] };
    expect(b.confermate).toEqual([]);
  });
});

describe('gli ordini di SDG li leggono solo l admin e l account di SDG', () => {
  const leggi = () => ordiniSdg(new Request('http://localhost/api/sdg/ordini'));

  it('l admin e l account di SDG leggono gli ordini, con la frase della visita', async () => {
    stato.chi = { email: 'nicola@esempio.it', role: 'admin', id: 'u-nicola' };
    const r = await leggi();
    expect(r.status).toBe(200);
    const d = (await corpo(r)).data as unknown as { nome_attivita: string; visita: string }[];
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ nome_attivita: 'Caffè di Prova', visita: 'Visita: giovedì 3 dicembre alle 10:00' });
    stato.chi = { email: 'sdg.servizi@mycity-system.local', role: 'seller', id: SDG };
    expect((await leggi()).status).toBe(200);
  });

  it('il titolare, un altro negozio e un agente sono fuori; chi ha solo il link del preventivo non entra', async () => {
    for (const chi of [
      { email: 'titolare@esempio.it', role: 'seller', id: SELLER },
      { email: 'bruno@esempio.it', role: 'seller', id: ALTRO },
      { email: 'anna@esempio.it', role: 'seller', id: 'u-anna' },
      { email: 'cliente@esempio.it', role: 'buyer', id: 'u-cliente' },
    ]) {
      stato.chi = chi;
      const r = await leggi();
      expect(r.status, chi.email).toBe(403);
      expect(JSON.stringify(await r.json())).not.toContain('Caffè di Prova');
    }
    stato.chi = null;
    expect((await leggi()).status).toBe(401);
  });
});
