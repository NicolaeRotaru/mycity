import { describe, it, expect, vi, beforeEach } from 'vitest';
import { campiPerIlProfilo, datoDi, prodottiTipici, SchedaInArrivo, senzaPrezzo, valoreConfermato, type SchedaCliente } from '@/lib/agenzia/scheda-cliente';

/**
 * 24/11/2026 — LA SCHEDA DEL CLIENTE CHE MANDA N8N (Lavoro 2).
 *
 * Nicola: «n8n li manda al sito». La porta /api/agenzia/scheda-cliente si apre solo col segreto e
 * in https; la scheda si tiene intera. Nel profilo e in pubblico va solo quello che è «confermato»;
 * prezzi mai (li conferma il negoziante); un campo che non arriva resta vuoto.
 */

const ODG = '0de1905e-7000-4000-8000-000000000001';

function schedaDiProva(campi: SchedaCliente['campi'] = {}, extra: Partial<SchedaCliente> = {}): SchedaCliente {
  return SchedaInArrivo.parse({ tipo: 'scheda-cliente', origine: 'n8n-16', id_attivita: ODG, campi, ...extra });
}

describe('la scheda: cosa è vero e cosa va confermato', () => {
  const scheda = schedaDiProva(
    {
      indirizzo: { valore: 'Via Roma 10, Piacenza', stato: 'confermato', fonte: 'https://example.org/a' },
      telefono: { valore: '0523 123456', stato: 'da_confermare', fonte: 'https://example.org/b' },
      orari: { valore: 'Lun–Sab 7:00–19:30', stato: 'confermato', fonte: 'https://example.org/c' },
      menu_testo: { valore: '- Brioche alla crema\n- Cappuccino 1,50 €\nTorta di mele\nbrioche alla crema\nCannoli € 2', stato: 'da_confermare', fonte: null },
    },
    { da_confermare: ['orari'] },
  );

  it('un campo confermato è vero; uno da confermare, o elencato in da_confermare, no', () => {
    expect(valoreConfermato(scheda, 'indirizzo')).toBe('Via Roma 10, Piacenza');
    expect(valoreConfermato(scheda, 'telefono')).toBeNull();
    expect(valoreConfermato(scheda, 'orari')).toBeNull();
    expect(datoDi(scheda, 'telefono')).toEqual({ valore: '0523 123456', confermato: false });
    expect(datoDi(scheda, 'sito_ufficiale')).toBeNull();
  });

  it('nel profilo va solo l indirizzo confermato; il telefono mai, nemmeno «confermato» (per n8n vuol dire «trovato in una fonte»)', () => {
    const conTelefono = schedaDiProva({ telefono: { valore: '333 1234567', stato: 'confermato', fonte: 'https://example.org' } });
    expect(campiPerIlProfilo(conTelefono)).toEqual({});
    expect(campiPerIlProfilo(scheda)).toEqual({ store_address: 'Via Roma 10, Piacenza' });
    expect(campiPerIlProfilo(null)).toEqual({});
  });

  it('i prodotti tipici vengono dal menu, senza prezzi e senza doppioni', () => {
    expect(prodottiTipici(scheda)).toEqual(['Brioche alla crema', 'Torta di mele']);
    expect(prodottiTipici(scheda, 8, true)).toEqual([]);
  });

  it('nessuna forma di prezzo passa dal menu (i casi trovati dai due collaudi)', () => {
    const menu = [
      'Brioche:2', 'Cornetto euro 2 cad', '1,50 Brioche', '2,00 Cornetto', '3 euro Spremuta', 'Caffè 1.-', 'Spritz 4 E',
      'Tiramisù EUR2', 'Cornetto 1,5', 'Brioche 2', 'Caffè 1.20', 'Cappuccino € 1', 'Ginseng 1€', 'Orzo CHF 3',
      '1. Torta di mele', '- Cannoli siciliani', 'Crostata della casa',
    ].join('\n');
    const s = schedaDiProva({ menu_testo: { valore: menu, stato: 'confermato', fonte: null } });
    expect(prodottiTipici(s, 30, true)).toEqual(['Torta di mele', 'Cannoli siciliani', 'Crostata della casa']);
  });

  it('nelle frasi (idee, punti di forza) le monete e i numeri da prezzo si riconoscono; un orario no', () => {
    for (const t of ['Colazione a EUR 5', 'Caffè a euro 1', 'Promo euro 3 il lunedì', 'Aperitivo 8 euro', 'a soli 3,50€', 'Spritz 4 E', 'Cornetti 1,5']) {
      expect(senzaPrezzo(t), t).toBe(false);
    }
    for (const t of ['La brioche appena sfornata alle 7', 'Il dehors al tramonto', 'Tre generazioni di pasticceri']) {
      expect(senzaPrezzo(t), t).toBe(true);
    }
  });

  it('una scheda senza tipo giusto, con un id non valido o una fonte che non è un indirizzo web è rifiutata', () => {
    expect(SchedaInArrivo.safeParse({ tipo: 'altro', id_attivita: ODG, campi: {} }).success).toBe(false);
    expect(SchedaInArrivo.safeParse({ tipo: 'scheda-cliente', id_attivita: 'x', campi: {} }).success).toBe(false);
    expect(SchedaInArrivo.safeParse({ tipo: 'scheda-cliente', id_attivita: ODG, campi: { indirizzo: { valore: 'a', stato: 'confermato', fonte: 'javascript:alert(1)' } } }).success).toBe(false);
    expect(SchedaInArrivo.safeParse({ tipo: 'scheda-cliente', id_attivita: ODG, campi: { indirizzo: { valore: 'a', stato: 'verissimo' } } }).success).toBe(false);
  });
});

// ─── La porta per n8n ───────────────────────────────────────────────────────────────────
const db = vi.hoisted(() => ({
  profilo: null as null | { id: string; role: string },
  salvate: [] as Array<Record<string, unknown>>,
  erroreUpsert: null as null | { code: string; message: string },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfterSec: 0, limit: 60 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.profilo, error: null }) }) }) };
      if (tabella === 'schede_clienti') return { upsert: async (riga: Record<string, unknown>) => { if (db.erroreUpsert) return { error: db.erroreUpsert }; db.salvate.push(riga); return { error: null }; } };
      throw new Error(`tabella inattesa ${tabella}`);
    },
  }),
}));

const CORPO = {
  tipo: 'scheda-cliente', origine: 'n8n-16', id_attivita: ODG, chiave_cliente: 'ora-del-gusto',
  campi: { indirizzo: { valore: 'Via Roma 10', stato: 'confermato', fonte: 'https://example.org' } },
  analisi: { tipo_di_locale: 'bar e pasticceria', punti_di_forza: ['le brioche fatte in casa'] },
  da_confermare: [],
};

async function manda(corpo: unknown, opzioni: { segreto?: string | null; url?: string; proto?: string } = {}) {
  const { POST } = await import('@/app/api/agenzia/scheda-cliente/route');
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-proto': opzioni.proto ?? 'https' };
  if (opzioni.segreto !== null) headers['x-mycity-segreto'] = opzioni.segreto ?? 'segreto-di-prova';
  return POST(new Request(opzioni.url ?? 'https://mycity.example/api/agenzia/scheda-cliente', { method: 'POST', headers, body: JSON.stringify(corpo) }));
}

describe('/api/agenzia/scheda-cliente', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.N8N_SCHEDA_CLIENTE_SEGRETO = 'segreto-di-prova';
    db.profilo = { id: ODG, role: 'seller' };
    db.salvate = [];
    db.erroreUpsert = null;
  });

  it('con il segreto giusto la scheda si salva intera', async () => {
    const r = await manda(CORPO);
    expect(r.status).toBe(200);
    expect(db.salvate).toHaveLength(1);
    expect(db.salvate[0].id_attivita).toBe(ODG);
    expect((db.salvate[0].scheda as Record<string, unknown>).analisi).toEqual(CORPO.analisi);
  });

  it('senza segreto configurato la porta è chiusa', async () => {
    delete process.env.N8N_SCHEDA_CLIENTE_SEGRETO;
    expect((await manda(CORPO)).status).toBe(503);
    expect(db.salvate).toHaveLength(0);
  });

  it('senza segreto, o col segreto sbagliato, niente', async () => {
    expect((await manda(CORPO, { segreto: null })).status).toBe(401);
    expect((await manda(CORPO, { segreto: 'sbagliato' })).status).toBe(401);
    expect(db.salvate).toHaveLength(0);
  });

  it('in http fuori dal computer di prova, niente', async () => {
    expect((await manda(CORPO, { url: 'http://mycity.example/api/agenzia/scheda-cliente', proto: 'http' })).status).toBe(403);
    expect(db.salvate).toHaveLength(0);
  });

  it('niente schede per SDG o MyCity, né per chi non è un venditore', async () => {
    expect((await manda({ ...CORPO, id_attivita: '11111111-1111-1111-1111-5d9000000001' })).status).toBe(400);
    db.profilo = { id: ODG, role: 'buyer' };
    expect((await manda(CORPO)).status).toBe(404);
    db.profilo = null;
    expect((await manda(CORPO)).status).toBe(404);
    expect(db.salvate).toHaveLength(0);
  });

  it('una scheda oltre il limite del database risponde 413, non «riprova» (n8n non insiste a vuoto)', async () => {
    db.erroreUpsert = { code: '23514', message: 'violates check constraint' };
    expect((await manda(CORPO)).status).toBe(413);
  });

  it('una scheda fuori formato è rifiutata', async () => {
    expect((await manda({ ...CORPO, campi: { indirizzo: { valore: 'x', stato: 'boh' } } })).status).toBe(400);
  });
});
