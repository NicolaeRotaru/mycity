import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { nuovoDb, supabaseFinto, type DbFinto } from '../agenzia/_supabase-finto';

/**
 * LA MAPPA DEI CLIENTI DA VISITARE — 28/11/2026 (migrazione 999i).
 *
 * Ogni agente vede tutta la mappa e prenota da solo («Ci vado io» / «Lascio»); dopo la visita segna lo stato.
 * Queste prove diventano rosse se:
 *  · uno che non è agente attivo (o admin) arriva alla tabella dalle rotte /api/agente/clienti;
 *  · un agente vede chi ha preso un cliente (l'id o l'email di un collega);
 *  · un agente prende un cliente già preso, lo lascia al posto dell'altro, o gli cambia lo stato;
 *  · la porta di n8n si apre senza segreto o col segreto sbagliato, o scrive prenotazioni e stati;
 *  · la lista non è in ordine di priorità di serie.
 */

const ANNA = 'a0000000-0000-4000-8000-00000000000a';
const BRUNO = 'b0000000-0000-4000-8000-00000000000b';
const SOSPESO = 'c0000000-0000-4000-8000-00000000000c';
const CURIOSO = 'd0000000-0000-4000-8000-00000000000d';
const NICOLA = 'e0000000-0000-4000-8000-00000000000e';

const stato = vi.hoisted(() => ({
  db: null as unknown as DbFinto,
  chi: null as null | { id: string; email: string; role: string },
  rpc: [] as { nome: string; args: Record<string, unknown> }[],
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    ...supabaseFinto(stato.db),
    rpc: async (nome: string, args: Record<string, unknown>) => { stato.rpc.push({ nome, args }); return { data: (args.p_righe as unknown[]).length, error: null }; },
  }),
}));
vi.mock('@/lib/rate-limit', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/lib/rate-limit')),
  getClientIp: () => '203.0.113.9',
  rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }),
}));
// La porta vera degli agenti (lib/agenti/rotta.ts) resta: si finge solo l'accesso col proprio account.
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, gestore: (c: Record<string, unknown>) => unknown) => async (req: Request) => {
    if (!stato.chi) return new Response(JSON.stringify({ ok: false }), { status: 401 });
    return gestore({ req, user: { id: stato.chi.id, email: stato.chi.email }, profile: { role: stato.chi.role }, params: {} });
  },
}));

const rotta = await import('@/app/api/agente/clienti/route');
const porta = await import('@/app/api/agenzia/clienti-da-visitare/route');
const { ordina, coloreDi, daMostrare, telDaChiamare, categoriaDi } = await import('@/lib/agenti/clienti-vista');
const { pulisciFila } = await import('@/lib/agenti/clienti');

const GET = rotta.GET as unknown as (r: Request) => Promise<Response>;
const POST = rotta.POST as unknown as (r: Request) => Promise<Response>;
const leggi = () => GET(new Request('https://mycity.test/api/agente/clienti'));
const tocca = (corpo: unknown) => POST(new Request('https://mycity.test/api/agente/clienti', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }));
const come = (id: string, email: string, role = 'customer') => { stato.chi = { id, email, role }; };
const riga = (osm: string) => stato.db.tabelle.clienti_da_visitare.find((r) => r.osm === osm)!;
type Cl = { osm: string; presa: string; stato: string; presaDa?: string | null; punteggio: number };
const dati = async (r: Response) => ((await r.json()) as { data: { admin: boolean; clienti: Cl[] } }).data;

const base = (osm: string, nome: string, punteggio: number, extra: Record<string, unknown> = {}) => ({
  osm, nome, tipo: 'panetteria', segmento: 'fresco', indirizzo: 'Via Calzolai 1', telefono: '0523 123456', sito: null, lat: 45.05, lon: 9.69,
  distanza_m: 300, punteggio, perche: 'fresco vicino a Pane Quotidiano', offerta: 'sito, social', mappa: 'https://www.google.com/maps/search/?api=1&query=x',
  dossier: null, settimana: null, in_fila: true, prenotata_da: null, stato: 'da_visitare', ...extra,
});

beforeEach(() => {
  const db = nuovoDb();
  db.tabelle.agenti = [
    { user_id: ANNA, email: 'anna@esempio.it', attivo: true },
    { user_id: BRUNO, email: 'bruno@esempio.it', attivo: true },
    { user_id: SOSPESO, email: 'sospeso@esempio.it', attivo: false },
  ];
  db.tabelle.clienti_da_visitare = [
    base('node/1', 'Forno Uno', 80),
    base('node/2', 'Bar Due', 120, { prenotata_da: BRUNO }),
    base('way/3', 'Fiori Tre', 95, { distanza_m: 50 }),
  ];
  stato.db = db;
  stato.rpc = [];
  stato.chi = null;
  process.env.N8N_CLIENTI_DA_VISITARE_SEGRETO = 'segreto-di-prova-lungo-abbastanza';
});

describe('chi arriva alla mappa', () => {
  it('senza account: 401', async () => { expect((await leggi()).status).toBe(401); });
  it('un account che non è agente non legge e non prende', async () => {
    come(CURIOSO, 'curioso@esempio.it');
    expect((await leggi()).status).toBe(403);
    expect((await tocca({ osm: 'node/1', azione: 'prendi' })).status).toBe(403);
    expect(riga('node/1').prenotata_da).toBeNull();
  });
  it('un agente sospeso non legge e non prende', async () => {
    come(SOSPESO, 'sospeso@esempio.it');
    expect((await leggi()).status).toBe(403);
    expect((await tocca({ osm: 'node/1', azione: 'prendi' })).status).toBe(403);
  });
  it('un agente attivo legge tutta la mappa, in ordine di priorità', async () => {
    come(ANNA, 'anna@esempio.it');
    const r = await leggi();
    expect(r.status).toBe(200);
    expect((await dati(r)).clienti.map((c) => c.osm)).toEqual(['node/2', 'way/3', 'node/1']);
  });
});

describe('le prenotazioni: ognuno le sue', () => {
  it('di un cliente preso da un collega, l agente sa solo che è preso: né chi né l id', async () => {
    come(ANNA, 'anna@esempio.it');
    const r = await leggi();
    const testo = await r.clone().text();
    expect(testo).not.toContain(BRUNO);
    expect(testo).not.toContain('bruno@esempio.it');
    const due = (await dati(r)).clienti.find((c) => c.osm === 'node/2')!;
    expect(due.presa).toBe('altro');
    expect(due).not.toHaveProperty('presaDa');
  });
  it('«Ci vado io» su un cliente libero: diventa mio; il collega lo vede preso', async () => {
    come(ANNA, 'anna@esempio.it');
    const r = await tocca({ osm: 'node/1', azione: 'prendi' });
    expect(r.status).toBe(200);
    expect(riga('node/1').prenotata_da).toBe(ANNA);
    come(BRUNO, 'bruno@esempio.it');
    expect((await dati(await leggi())).clienti.find((c) => c.osm === 'node/1')!.presa).toBe('altro');
  });
  it('un cliente già preso da un altro non si prende: 409, e resta suo', async () => {
    come(ANNA, 'anna@esempio.it');
    expect((await tocca({ osm: 'node/2', azione: 'prendi' })).status).toBe(409);
    expect(riga('node/2').prenotata_da).toBe(BRUNO);
  });
  it('non si lascia il cliente di un altro', async () => {
    come(ANNA, 'anna@esempio.it');
    expect((await tocca({ osm: 'node/2', azione: 'lascia' })).status).toBe(403);
    expect(riga('node/2').prenotata_da).toBe(BRUNO);
  });
  it('non si cambia lo stato del cliente di un altro, né di uno libero', async () => {
    come(ANNA, 'anna@esempio.it');
    expect((await tocca({ osm: 'node/2', azione: 'stato', stato: 'no' })).status).toBe(403);
    expect(riga('node/2').stato).toBe('da_visitare');
    expect((await tocca({ osm: 'node/1', azione: 'stato', stato: 'si' })).status).toBe(403);
    expect(riga('node/1').stato).toBe('da_visitare');
  });
  it('il mio cliente: lo stato con una parola, e lo lascio (lo stato resta)', async () => {
    come(BRUNO, 'bruno@esempio.it');
    const r = await tocca({ osm: 'node/2', azione: 'stato', stato: 'iscritta' });
    expect(r.status).toBe(200);
    expect(riga('node/2')).toMatchObject({ stato: 'iscritta', stato_da: BRUNO });
    expect((await tocca({ osm: 'node/2', azione: 'stato', stato: 'forse' })).status).toBe(400);
    expect((await tocca({ osm: 'node/2', azione: 'lascia' })).status).toBe(200);
    expect(riga('node/2')).toMatchObject({ prenotata_da: null, stato: 'iscritta' });
  });
  it('non si scrive nessun altro campo: l agente non sceglie a chi intestare il cliente', async () => {
    come(ANNA, 'anna@esempio.it');
    await tocca({ osm: 'node/1', azione: 'prendi', prenotata_da: BRUNO, punteggio: 999 });
    expect(riga('node/1')).toMatchObject({ prenotata_da: ANNA, punteggio: 80 });
  });
  it('«esclusa» la mette solo l admin, e non conta come visitata', async () => {
    come(BRUNO, 'bruno@esempio.it');
    expect((await tocca({ osm: 'node/2', azione: 'stato', stato: 'esclusa' })).status).toBe(403);
    expect(riga('node/2').stato).toBe('da_visitare');
    come(NICOLA, 'nicola@esempio.it', 'admin');
    expect((await tocca({ osm: 'node/2', azione: 'stato', stato: 'esclusa' })).status).toBe(200);
    const { statiPerIlFlusso } = await import('@/lib/agenti/clienti');
    const { getAdminSupabase } = await import('@/lib/supabase/server');
    expect((await statiPerIlFlusso(getAdminSupabase() as never)).conti).toMatchObject({ visitate: 0, escluse: 1 });
  });
  it('un identificativo storto o un cliente che non c è: 400 o 404', async () => {
    come(ANNA, 'anna@esempio.it');
    expect((await tocca({ osm: "node/1' or 1=1", azione: 'prendi' })).status).toBe(400);
    expect((await tocca({ osm: 'node/99', azione: 'prendi' })).status).toBe(404);
  });
  it('due clienti con lo stesso punteggio: le pagine si leggono in un ordine stabile (punteggio, poi osm)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/agenti/clienti.ts'), 'utf8');
    expect(src).toContain(".order('punteggio', { ascending: false, nullsFirst: false }).order('osm', { ascending: true }).range(");
  });
  it('l admin vede chi ha preso cosa e può liberare', async () => {
    come(NICOLA, 'nicola@esempio.it', 'admin');
    const d = await dati(await leggi());
    expect(d.admin).toBe(true);
    expect(d.clienti.find((c) => c.osm === 'node/2')!.presaDa).toBe('bruno@esempio.it');
    expect((await tocca({ osm: 'node/2', azione: 'lascia' })).status).toBe(200);
    expect(riga('node/2').prenotata_da).toBeNull();
  });
});

describe('l agente sospeso', () => {
  it('i suoi clienti tornano liberi, gli stati restano', async () => {
    const { liberaIClientiDi } = await import('@/lib/agenti/clienti');
    riga('node/2').stato = 'visitata';
    const { getAdminSupabase } = await import('@/lib/supabase/server');
    expect(await liberaIClientiDi(getAdminSupabase() as never, BRUNO)).toBe(1);
    expect(riga('node/2')).toMatchObject({ prenotata_da: null, stato: 'visitata' });
  });
  it('Admin → Agenti → sospendi libera i suoi clienti', () => {
    const rotta = fs.readFileSync(path.join(process.cwd(), 'app/api/admin/agenti/route.ts'), 'utf8');
    expect(rotta).toMatch(/if \(m\.azione === 'sospendi'\) \{\s*try \{ await liberaIClientiDi\(admin, m\.userId\)/);
  });
});

describe('la porta di n8n (flusso 16)', () => {
  const manda = (corpo: unknown, segreto?: string) => (porta.POST as unknown as (r: Request) => Promise<Response>)(new Request('https://mycity.test/api/agenzia/clienti-da-visitare', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https', ...(segreto ? { 'x-mycity-segreto': segreto } : {}) }, body: JSON.stringify(corpo),
  }));
  const chiedi = (segreto?: string) => (porta.GET as unknown as (r: Request) => Promise<Response>)(new Request('https://mycity.test/api/agenzia/clienti-da-visitare', {
    headers: { 'x-forwarded-proto': 'https', ...(segreto ? { 'x-mycity-segreto': segreto } : {}) },
  }));
  const S = 'segreto-di-prova-lungo-abbastanza';
  const GIRO = new Date().toISOString();
  const fila = { giro: GIRO, attivita: [{ osm: 'node/7', nome: 'Macelleria Sette', lat: 45.051, lon: 9.69, punteggio: 110.4, distanza_m: 200, prenotata_da: ANNA, stato: 'iscritta' }] };

  it('senza segreto configurato resta chiusa (503); senza segreto o col segreto sbagliato: 401', async () => {
    delete process.env.N8N_CLIENTI_DA_VISITARE_SEGRETO;
    expect((await manda(fila, S)).status).toBe(503);
    process.env.N8N_CLIENTI_DA_VISITARE_SEGRETO = S;
    expect((await manda(fila)).status).toBe(401);
    expect((await manda(fila, 'sbagliato')).status).toBe(401);
    expect((await chiedi('sbagliato')).status).toBe(401);
    expect(stato.rpc).toHaveLength(0);
  });
  it('col segreto giusto scrive la fila, ma mai prenotazioni o stati', async () => {
    const r = await manda(fila, S);
    expect(r.status).toBe(200);
    expect(stato.rpc).toHaveLength(1);
    const righe = stato.rpc[0].args.p_righe as Record<string, unknown>[];
    expect(righe[0]).toMatchObject({ osm: 'node/7', lat: 45.051, lon: 9.69, punteggio: 110.4 });
    expect(righe[0]).not.toHaveProperty('prenotata_da');
    expect(righe[0]).not.toHaveProperty('stato');
    expect(stato.rpc[0].args.p_giro).toBe(GIRO);
  });
  it('un giro lontano da adesso non entra: terrebbe accese o spegnerebbe le righe sbagliate', async () => {
    expect((await manda({ ...fila, giro: '2099-01-01T00:00:00.000Z' }, S)).status).toBe(400);
    expect((await manda({ ...fila, giro: '2026-01-01T00:00:00.000Z' }, S)).status).toBe(400);
    expect(stato.rpc).toHaveLength(0);
  });
  it('una fila vuota non spegne la mappa', async () => {
    expect((await manda({ giro: fila.giro, attivita: [] }, S)).status).toBe(400);
    expect(stato.rpc).toHaveLength(0);
  });
  it('il GET dà al flusso gli stati del sito e il conto', async () => {
    stato.db.tabelle.clienti_da_visitare[0].settimana = '2026-11-23';
    stato.db.tabelle.clienti_da_visitare[2].stato = 'si';
    const r = await chiedi(S);
    expect(r.status).toBe(200);
    const d = ((await r.json()) as { data: { stati: { osm: string; proposta: boolean; presa: boolean; stato: string }[]; conti: Record<string, number> } }).data;
    expect(d.stati.find((s) => s.osm === 'node/1')).toEqual({ osm: 'node/1', proposta: true, presa: false, stato: 'da_visitare' });
    expect(d.stati.find((s) => s.osm === 'node/2')!.presa).toBe(true);
    expect(d.conti).toMatchObject({ proposte: 1, prese: 1, visitate: 1, si: 1, iscritte: 0 });
    expect(JSON.stringify(d)).not.toContain(BRUNO);
  });
});

describe('pulire quello che manda n8n', () => {
  it('una data che non esiste, un carattere nullo o mezza posizione non fanno fallire il giro', () => {
    const { righe } = pulisciFila([
      { osm: 'node/5', nome: 'Bar\u0000 Cinque', settimana: '2026-02-30', lat: 45.05 },
      { osm: 'node/6', nome: 'Sei', settimana: '2026-11-30', lat: 45.05, lon: 9.69 },
    ]);
    expect(righe[0]).toMatchObject({ nome: 'Bar Cinque', settimana: null, lat: null, lon: null });
    expect(righe[1]).toMatchObject({ settimana: '2026-11-30', lat: 45.05, lon: 9.69 });
  });
  it('scarta righe storte, toglie doppioni, legge lo stato della tabella n8n solo con le parole giuste', () => {
    const { righe, scartate } = pulisciFila([
      { osm: 'node/1', nome: 'A', stato_tabella: 'Sì' },
      { osm: 'node/1', nome: 'A bis', stato_tabella: 'sì, non ancora iscritta' },
      { osm: 'bottega/2', nome: 'B' },
      { osm: 'node/3', nome: '' },
      { osm: 'way/4', nome: 'D', lat: 200, mappa: 'https://malevolo.example/x', stato_tabella: 'Iscritta' },
      { osm: 'way/8', nome: 'E', stato_tabella: 'Esclusa' },
    ]);
    expect(scartate).toBe(2);
    expect(righe.map((r) => [r.osm, r.nome, r.stato_iniziale])).toEqual([['node/1', 'A bis', null], ['way/4', 'D', 'iscritta'], ['way/8', 'E', 'esclusa']]);
    expect(righe[1]).toMatchObject({ lat: null, mappa: null });
  });
});

describe('come si mostra', () => {
  const c = (osm: string, punteggio: number, extra: Record<string, unknown> = {}) => ({
    osm, nome: osm, tipo: null, segmento: null, indirizzo: null, telefono: null, sito: null, lat: 45, lon: 9.7, distanzaM: 100, punteggio,
    perche: null, offerta: null, mappa: null, dossier: null, settimana: null, inFila: true, stato: 'da_visitare' as const, presa: 'libera' as const, ...extra,
  });
  it('di serie per priorità; poi distanza; «le mie» per prime', () => {
    const l = [c('a', 10, { distanzaM: 50 }), c('b', 90, { distanzaM: 900 }), c('m', 30, { presa: 'mia' })];
    expect(ordina(l, 'priorita').map((x) => x.osm)).toEqual(['b', 'm', 'a']);
    expect(ordina(l, 'distanza').map((x) => x.osm)).toEqual(['a', 'm', 'b']);
    expect(ordina(l, 'mie').map((x) => x.osm)).toEqual(['m', 'b', 'a']);
  });
  it('il colore: prima l esito della visita, poi la prenotazione', () => {
    expect(coloreDi({ stato: 'iscritta', presa: 'altro' })).toBe('si');
    expect(coloreDi({ stato: 'da_visitare', presa: 'mia' })).toBe('mia');
    expect(coloreDi({ stato: 'da_visitare', presa: 'altro' })).toBe('altro');
    expect(coloreDi({ stato: 'da_visitare', presa: 'libera' })).toBe('libera');
  });
  it('chi esce dalla fila resta solo se qualcuno ci ha lavorato', () => {
    expect(daMostrare(c('x', 1, { inFila: false }))).toBe(false);
    expect(daMostrare(c('x', 1, { inFila: false, stato: 'no' }))).toBe(true);
    expect(daMostrare(c('x', 1, { stato: 'esclusa' }))).toBe(false);
  });
  it('l icona della categoria: dal tipo, poi dal segmento; quello che non si riconosce va su «altri negozi»', () => {
    const k = (tipo: string | null, segmento: string | null = null) => categoriaDi({ tipo, segmento });
    expect(k('panetteria', 'fresco')).toBe('panetteria');
    expect(k('macelleria', 'fresco')).toBe('macelleria');
    expect(k('frutta e verdura')).toBe('frutta');
    expect(k('gastronomia')).toBe('formaggi');
    expect(k('pasticceria')).toBe('pasticceria');
    expect(k('enoteca', 'regali')).toBe('regali');
    expect(k('parrucchiere', 'cura della persona')).toBe('persona');
    expect(k('gelateria', 'bar e ristoranti')).toBe('ristoro');
    expect(k('artigiano (shoemaker)', 'artigiani')).toBe('artigiani');
    expect(k('pescheria', 'pescheria (fase 2)')).toBe('altri');
    expect(k(null, null)).toBe('altri');
    expect(k('abbigliamento', 'altri negozi')).toBe('altri');
  });
  it('il telefono da toccare', () => {
    expect(telDaChiamare('+39 0523 123 456')).toBe('+390523123456');
    expect(telDaChiamare('n/d')).toBeNull();
  });
});

describe('la migrazione 999i', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'migrations/999i_la_mappa_dei_clienti_da_visitare.sql'), 'utf8');
  it('il browser non legge e non scrive la tabella; la funzione la chiama solo il server', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON public\.clienti_da_visitare FROM anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.ricevi_clienti_da_visitare\(jsonb, timestamptz\) FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/CREATE POLICY/);
  });
  it('il giro di n8n non tocca prenotazioni e stati', () => {
    const aggiorna = sql.slice(sql.indexOf('ON CONFLICT (osm) DO UPDATE SET'), sql.indexOf('GET DIAGNOSTICS'));
    expect(aggiorna).not.toMatch(/prenotata_da|prenotata_il|stato\s*=|stato_da|stato_il/);
  });
});
