import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 22/11/2026 — /api/seller/preventivo: GET prepara il preventivo dai dati del
 * database, POST lo accetta.
 *
 *  · il preventivo si calcola sul server, coi prodotti e la vetrina veri;
 *  · «non ho letto i prodotti» non diventa «non manca niente»;
 *  · all'accettazione il browser manda solo QUALI voci: una voce che non manca
 *    non entra, e se non resta niente lo dice;
 *  · l'avviso a Nicola parte una volta sola, con le voci e il telefono;
 *  · se l'avviso non si scrive, il cliente non legge «ricevuto»;
 *  · il flusso n8n parte solo se Nicola l'ha collegato, e solo in https.
 */

const stato = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  prodotti: [] as { images: unknown }[],
  erroreProdotti: null as null | { message: string },
  agenzia: {} as unknown,
  erroreImpostazioni: null as null | { code: string; message: string },
  avvisi: [] as { titolo: string; corpo: string; opzioni: Record<string, unknown> }[],
  esitoAvviso: 'scritto' as 'scritto' | 'gia-mandato' | Error,
}));

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuthRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'a1b2c3d4-0000', email: 'bar@esempio.it' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: async (titolo: string, corpo: string, _link: string, opzioni: Record<string, unknown>) => {
    if (stato.esitoAvviso instanceof Error) throw stato.esitoAvviso;
    stato.avvisi.push({ titolo, corpo, opzioni });
    return stato.esitoAvviso;
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.limit = async () => ({ data: stato.erroreProdotti ? null : stato.prodotti, error: stato.erroreProdotti });
      c.maybeSingle = async () =>
        tabella === 'profiles'
          ? { data: stato.profilo, error: null }
          : stato.erroreImpostazioni
            ? { data: null, error: stato.erroreImpostazioni }
            : { data: { agenzia: stato.agenzia }, error: null };
      return c;
    },
  }),
}));

const { GET, POST } = await import('@/app/api/seller/preventivo/route');

const chiama = (metodo: 'GET' | 'POST', corpo?: unknown) => {
  const r = new Request('http://localhost/api/seller/preventivo', { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return ((metodo === 'GET' ? GET : POST) as unknown as (r: Request) => Promise<Response>)(r);
};

const fetchVero = globalThis.fetch;

beforeEach(() => {
  stato.profilo = {
    store_name: 'Bar Roma', store_logo: null, store_media: [], store_phone: '3331234567',
    business_type: 'bar', store_customization: { socials: { instagram: 'barroma' } },
  };
  stato.prodotti = [{ images: [] }, { images: ['https://esempio.it/a.jpg'] }];
  stato.erroreProdotti = null;
  stato.agenzia = {};
  stato.erroreImpostazioni = null;
  stato.avvisi = [];
  stato.esitoAvviso = 'scritto';
  delete process.env.N8N_PREVENTIVO_WEBHOOK_URL;
  delete process.env.N8N_PREVENTIVO_SEGRETO;
});
afterEach(() => {
  globalThis.fetch = fetchVero;
});

describe('GET /api/seller/preventivo', () => {
  it('prepara il preventivo dai dati veri della vetrina', async () => {
    const r = await chiama('GET');
    expect(r.status).toBe(200);
    const { data } = (await r.json()) as { data: { attivita: string; tipoAttivita: string; righe: { id: string; perche: string[] }[] } };
    expect(data.attivita).toBe('Bar Roma');
    expect(data.tipoAttivita).toBe('bar');
    expect(data.righe.map((x) => x.id)).toEqual(['foto_video', 'social', 'sito_web', 'google_maps']);
    expect(data.righe[0].perche).toContain('1 prodotto è senza foto, su 2 in catalogo.');
  });

  it('prima della migrazione 703 vale il listino; con un altro guasto di lettura tutto è «su richiesta»', async () => {
    type R = { data: { righe: { id: string; prezzo: unknown }[] } };
    stato.erroreImpostazioni = { code: '42703', message: 'column site_settings.agenzia does not exist' };
    const prima = (await (await chiama('GET')).json()) as R;
    expect(prima.data.righe.find((x) => x.id === 'sito_web')?.prezzo).toEqual({ da: 50000, a: 50000 });
    stato.erroreImpostazioni = { code: '57014', message: 'canceling statement due to statement timeout' };
    const guasto = (await (await chiama('GET')).json()) as R;
    expect(guasto.data.righe.every((x) => x.prezzo === null)).toBe(true);
  });

  it('se i prodotti non si leggono non dice «a posto»: dice che non è riuscito', async () => {
    stato.erroreProdotti = { message: 'timeout' };
    expect((await chiama('GET')).status).toBe(500);
  });
});

describe('POST /api/seller/preventivo', () => {
  it('l avviso arriva a Nicola una volta sola, con le voci scelte e il telefono', async () => {
    const r = await chiama('POST', { scelte: ['sito_web', 'social'] });
    expect(r.status).toBe(200);
    expect(stato.avvisi).toHaveLength(1);
    expect(stato.avvisi[0].titolo).toBe('Preventivo accettato: Bar Roma');
    expect(stato.avvisi[0].corpo).toContain('Gestione automatica dei social, Sito web professionale');
    expect(stato.avvisi[0].corpo).toContain('3331234567');
    expect(stato.avvisi[0].corpo).toMatch(/Totale: una volta 500,00\s€; ogni mese 300,00\s€ al mese/);
    // l'id intero dell'attività è nella chiave: due negozi con le stesse prime 6 cifre non si scambiano
    expect(stato.avvisi[0].opzioni.unaVoltaPer).toMatch(/^preventivo-agenzia:a1b2c3d4-0000:P-\d{8}-A1B2C3:social\+sito_web$/);
    expect(stato.avvisi[0].opzioni.almenoUnDestinatario).toBe(true);
  });

  it('una voce che non manca non entra; se non resta niente lo dice e non avvisa', async () => {
    stato.profilo = { ...stato.profilo, store_customization: { socials: { instagram: 'barroma', website: 'https://barroma.it' } } };
    const r = await chiama('POST', { scelte: ['sito_web'] });
    expect(r.status).toBe(409);
    expect(stato.avvisi).toHaveLength(0);
  });

  it('una voce fuori listino o nessuna voce: richiesta rifiutata', async () => {
    expect((await chiama('POST', { scelte: ['caffe_gratis'] })).status).toBe(400);
    expect((await chiama('POST', { scelte: ['logo'] })).status).toBe(400); // il logo non è più nel preventivo (23/11)
    expect((await chiama('POST', { scelte: [] })).status).toBe(400);
    expect(stato.avvisi).toHaveLength(0);
  });

  it('se l avviso non si scrive, il cliente non legge «ricevuto»', async () => {
    stato.esitoAvviso = new Error('nessun amministratore');
    expect((await chiama('POST', { scelte: ['social'] })).status).toBe(500);
  });

  it('il flusso n8n è spento finché Nicola non lo collega', async () => {
    const spia = vi.fn();
    globalThis.fetch = spia as unknown as typeof fetch;
    const r = await chiama('POST', { scelte: ['social'] });
    expect(((await r.json()) as { data: { flusso: string } }).data.flusso).toBe('spento');
    expect(spia).not.toHaveBeenCalled();
  });

  it('collegato, il flusso n8n riceve le voci, i contatti e il segreto', async () => {
    process.env.N8N_PREVENTIVO_WEBHOOK_URL = 'https://n8n.esempio.it/webhook/preventivo';
    process.env.N8N_PREVENTIVO_SEGRETO = 'segreto-di-prova';
    const spia = vi.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = spia as unknown as typeof fetch;
    const r = await chiama('POST', { scelte: ['social'] });
    expect(((await r.json()) as { data: { flusso: string } }).data.flusso).toBe('inviato');
    const [indirizzo, opzioni] = spia.mock.calls[0] as unknown as [string, RequestInit];
    expect(indirizzo).toBe('https://n8n.esempio.it/webhook/preventivo');
    expect((opzioni.headers as Record<string, string>)['x-mycity-segreto']).toBe('segreto-di-prova');
    const corpo = JSON.parse(String(opzioni.body));
    expect(corpo.tipo).toBe('preventivo-accettato');
    expect(corpo.contatti).toEqual({ email: 'bar@esempio.it', telefono: '3331234567' });
    expect(corpo.socials).toEqual({ instagram: 'barroma' });
    expect(corpo.voci.map((v: { id: string }) => v.id)).toEqual(['social']);
  });

  it('un indirizzo n8n non https non riceve niente, e il cliente ha comunque il suo «ricevuto»', async () => {
    process.env.N8N_PREVENTIVO_WEBHOOK_URL = 'http://n8n.esempio.it/webhook';
    const spia = vi.fn();
    globalThis.fetch = spia as unknown as typeof fetch;
    const r = await chiama('POST', { scelte: ['social'] });
    expect(r.status).toBe(200);
    expect(spia).not.toHaveBeenCalled();
  });

  it('se l avviso era già partito oggi, n8n non riparte una seconda volta', async () => {
    process.env.N8N_PREVENTIVO_WEBHOOK_URL = 'https://n8n.esempio.it/webhook/preventivo';
    stato.esitoAvviso = 'gia-mandato';
    const spia = vi.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = spia as unknown as typeof fetch;
    const r = await chiama('POST', { scelte: ['social'] });
    expect(((await r.json()) as { data: { giaInviato: boolean } }).data.giaInviato).toBe(true);
    expect(spia).not.toHaveBeenCalled();
  });
});
