import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 24/11/2026 — Nicola: «un nuovo cliente che si collega a MyCity si inserisce nel
 * database dei clienti, e deve sfruttare il modulo 12».
 *
 * Quando un'attività manda la richiesta di entrare, /api/seller/apply passa la
 * nuova attività al flusso n8n «16 · Nuovo cliente da MyCity», che riusa il
 * modulo 12 e scrive la scheda nel foglio Clienti. Qui si chiama la rotta vera:
 *
 *  · spento finché Nicola non scrive indirizzo E segreto;
 *  · collegato, n8n riceve nome, tipo, indirizzo, città e descrizione, col segreto;
 *  · nessun dato personale del titolare esce dal sito (codice fiscale, IBAN,
 *    nome e cognome, data di nascita, telefono, email);
 *  · un indirizzo non https, o senza segreto, non riceve niente;
 *  · una richiesta già in attesa che il negozio corregge non è un cliente nuovo;
 *  · se n8n è giù o risponde male, l'iscrizione va comunque a buon fine.
 */

const stato = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  avvisi: 0,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'utente-1', email: 'bar@esempio.it' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: async () => {
    stato.avvisi += 1;
    return 'scritto';
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      let valori: Record<string, unknown> | null = null;
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.or = () => c;
      c.insert = async () => ({ error: null });
      c.maybeSingle = async () => ({ data: stato.profilo, error: null });
      c.update = (v: Record<string, unknown>) => { valori = v; return c; };
      (c as { then: unknown }).then = (ok: (v: unknown) => void) =>
        ok(valori ? { data: [{ id: 'utente-1' }], error: null } : { data: null, error: null });
      return c;
    },
  }),
}));

const { POST } = await import('@/app/api/seller/apply/route');

const modulo = {
  businessType: 'bar',
  contactPhone: '3331234567',
  legalFirstName: 'Mario',
  legalLastName: 'Rossi',
  legalFiscalCode: 'RSSMRA80E05G535X',
  legalBirthDate: '1980-05-05',
  legalResidenceAddr: 'Via Verdi 9',
  legalResidenceCity: 'Podenzano',
  legalResidenceZip: '29027',
  businessLegalName: 'Bar Roma di Mario Rossi',
  businessVatNumber: '01234567897',
  businessAddress: 'Via Roma 1',
  businessCity: 'Piacenza',
  businessZip: '29121',
  storeName: 'Bar Roma',
  storeDescription: 'Colazioni e aperitivi in centro',
  billingIban: 'IT60X0542811101000000123456',
  storeLogo: null,
  storeMedia: [],
  storeAddress: 'Via Roma 1, 29121 Piacenza',
  storeLat: 45.05,
  storeLng: 9.69,
  acceptTos: true,
  acceptPrivacy: true,
  acceptAccuracy: true,
};

const invia = (corpo: unknown = modulo) =>
  (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/seller/apply', { method: 'POST', body: JSON.stringify(corpo) }),
  );

const fetchVero = globalThis.fetch;
let chiamate: { url: string; init: RequestInit }[] = [];
let risposta: () => Promise<Response> = async () => new Response('{}', { status: 200 });

const collega = () => {
  process.env.N8N_NUOVO_CLIENTE_WEBHOOK_URL = 'https://n8n.esempio.it/webhook/mycity-nuovo-cliente';
  process.env.N8N_NUOVO_CLIENTE_SEGRETO = 'segreto-di-prova';
};

beforeEach(() => {
  stato.profilo = { role: 'buyer', approval_status: 'pending', approval_requested_at: null };
  stato.avvisi = 0;
  chiamate = [];
  risposta = async () => new Response('{}', { status: 200 });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    chiamate.push({ url: String(url), init });
    return risposta();
  }) as unknown as typeof fetch;
  delete process.env.N8N_NUOVO_CLIENTE_WEBHOOK_URL;
  delete process.env.N8N_NUOVO_CLIENTE_SEGRETO;
});
afterEach(() => {
  globalThis.fetch = fetchVero;
});

describe('la nuova attività arriva alla scheda Clienti (flusso n8n 16, modulo 12)', () => {
  it('spento finché Nicola non lo collega: nessuna chiamata, iscrizione a buon fine', async () => {
    const r = await invia();
    expect(r.status).toBe(200);
    expect(chiamate).toHaveLength(0);
    expect(stato.avvisi).toBe(1);
  });

  it('collegato, n8n riceve una volta sola nome, tipo, indirizzo, città e descrizione, col segreto', async () => {
    collega();
    const r = await invia();
    expect(r.status).toBe(200);
    expect(chiamate).toHaveLength(1);
    const { url, init } = chiamate[0];
    expect(url).toBe('https://n8n.esempio.it/webhook/mycity-nuovo-cliente');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-mycity-segreto']).toBe('segreto-di-prova');
    const corpo = JSON.parse(String(init.body));
    expect(corpo.tipo).toBe('nuovo-cliente');
    expect(corpo.origine).toBe('mycity');
    expect(corpo.attivita).toEqual({
      id: 'utente-1',
      nome: 'Bar Roma',
      tipo: 'bar',
      tipo_descritto: expect.stringMatching(/bar/i),
      indirizzo: 'Via Roma 1, 29121 Piacenza',
      citta: 'Piacenza',
      descrizione: 'Colazioni e aperitivi in centro',
    });
  });

  it('nessun dato personale del titolare esce dal sito', async () => {
    collega();
    await invia();
    const testo = String(chiamate[0].init.body);
    for (const personale of ['RSSMRA80E05G535X', 'IT60X0542811101000000123456', 'Mario', 'Rossi', '1980-05-05',
      '3331234567', 'bar@esempio.it', 'Via Verdi 9', 'Podenzano', '01234567897']) {
      expect(testo).not.toContain(personale);
    }
  });

  it('senza segreto non parte niente: n8n la respingerebbe e la scheda si perderebbe in silenzio', async () => {
    collega();
    delete process.env.N8N_NUOVO_CLIENTE_SEGRETO;
    expect((await invia()).status).toBe(200);
    expect(chiamate).toHaveLength(0);
  });

  it('un indirizzo non https non riceve niente', async () => {
    collega();
    process.env.N8N_NUOVO_CLIENTE_WEBHOOK_URL = 'http://n8n.esempio.it/webhook/mycity-nuovo-cliente';
    expect((await invia()).status).toBe(200);
    expect(chiamate).toHaveLength(0);
  });

  it('una richiesta già in attesa che il negozio corregge non è un cliente nuovo', async () => {
    collega();
    stato.profilo = { role: 'seller', approval_status: 'pending', approval_requested_at: '2026-11-20T10:00:00Z' };
    expect((await invia()).status).toBe(200);
    expect(chiamate).toHaveLength(0);
    expect(stato.avvisi).toBe(0);
  });

  it('n8n giù: l iscrizione va comunque a buon fine', async () => {
    collega();
    risposta = async () => { throw new Error('connessione rifiutata'); };
    expect((await invia()).status).toBe(200);
    expect(chiamate).toHaveLength(1);
  });

  it('n8n risponde male (403, segreto sbagliato): l iscrizione va comunque a buon fine', async () => {
    collega();
    risposta = async () => new Response('Authorization data is wrong!', { status: 403 });
    expect((await invia()).status).toBe(200);
    expect(chiamate).toHaveLength(1);
  });
});

/**
 * 25/11/2026 — Nicola: «sistema la città vuota verso n8n». Il modulo corto di /sell non chiede
 * più la sede legale, e la città del flusso 16 veniva da lì. Adesso si ricava dall'indirizzo
 * del negozio, che il modulo corto manda sempre.
 */
describe('la città arriva al flusso anche col modulo corto', () => {
  it('senza sede legale, la città viene dall indirizzo del negozio', async () => {
    collega();
    const corto: Record<string, unknown> = {
      businessType: 'bar', businessTypeDetail: '', storeName: 'Bar Roma', businessVatNumber: '01234567897',
      contactPhone: '3331234567', acceptTos: true, acceptPrivacy: true, acceptAccuracy: true, acceptBilling: false,
      storeAddress: 'Via Roma 1, 29121 Piacenza', storeLat: 45.05, storeLng: 9.69,
    };
    expect((await invia(corto)).status).toBe(200);
    expect(chiamate).toHaveLength(1);
    expect(JSON.parse(String(chiamate[0].init.body)).attivita.citta).toBe('Piacenza');
  });

  it('come scrivono davvero l indirizzo: la città giusta, o niente se non si capisce', async () => {
    const { cittaDallIndirizzo } = await import('@/lib/agenzia/nuovo-cliente-n8n');
    const casi: Array<[string, string | null]> = [
      ['Via Roma 1, Piacenza', 'Piacenza'],
      ['Via Roma 1, 29121 Piacenza', 'Piacenza'],
      ['Via Roma 1, 29121 Piacenza PC', 'Piacenza'],
      ['Corso Vittorio Emanuele II 5, 29121 Piacenza (PC), Italia', 'Piacenza'],
      ['Via Emilia Parmense 10, San Lazzaro, Piacenza', 'Piacenza'],
      ['Piazza Cavalli 2, Castel San Giovanni', 'Castel San Giovanni'],
      ['Via Roma 1, 29121', null],
      ['Via Roma 1 Piacenza', null],
      ['', null],
    ];
    for (const [indirizzo, atteso] of casi) expect(cittaDallIndirizzo(indirizzo), indirizzo).toBe(atteso);
  });
});

