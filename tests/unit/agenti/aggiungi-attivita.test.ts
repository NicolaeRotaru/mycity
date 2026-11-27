import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * «AGGIUNGI ATTIVITÀ» DALLA PAGINA DELL'AGENTE — 27/11/2026.
 *
 * Nicola: il preventivo nasce quando il titolare dice sì, «con un clic dalla stessa pagina». Queste prove dicono:
 *  · si iscrive l'attività della scheda di QUEL lavoro, letta dal server, e solo se è dell'agente (o dell'admin);
 *  · partono solo i dati pubblici dell'attività; il sito solo se il programma l'ha aperto davvero in https;
 *  · all'agente torna il link del preventivo; Nicola riceve l'avviso una volta;
 *  · premere due volte ridà lo stesso link senza rimandare l'attività al flusso 16;
 *  · un'attività che ha già accettato il preventivo non si riscrive (409).
 */

const stato = vi.hoisted(() => ({
  agente: { email: 'agente@esempio.it', role: 'seller' as string },
  lavoro: null as null | Record<string, unknown>,
  iscritte: [] as Record<string, unknown>[],
  esitoIscrizione: { ok: true, id: 'att-1', nuova: true, sito: null } as Record<string, unknown>,
  codice: 'c'.repeat(64) as string | null,
  dopo: [] as { dalModulo12: boolean }[],
  avvisi: [] as string[],
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://www.mycity-marketplace.com' } }));
vi.mock('@/lib/agenti/rotta', () => ({
  conAgente: (_f: unknown, gestore: (c: Record<string, unknown>) => unknown) => (req: Request) =>
    gestore({ req, email: stato.agente.email, profile: { role: stato.agente.role }, user: { id: 'u1' } }),
}));
vi.mock('@/lib/agenti/n8n', () => ({ leggiLavoro: async () => stato.lavoro ?? { stato: 'sconosciuto', errore: 'Scheda non trovata.' } }));
vi.mock('@/lib/agenzia/nuova-attivita', async (originale) => ({
  ...(await originale<typeof import('@/lib/agenzia/nuova-attivita')>()),
  iscriviAttivita: async (_admin: unknown, a: Record<string, unknown>) => { stato.iscritte.push(a); return stato.esitoIscrizione; },
}));
vi.mock('@/lib/agenzia/dopo-iscrizione', () => ({
  avviaDopoLIscrizione: (_a: unknown, fatto: { nuova: boolean }, _x: unknown, o: { dalModulo12: boolean }) => { if (fatto.nuova) stato.dopo.push({ dalModulo12: o.dalModulo12 }); },
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: async (titolo: string) => { stato.avvisi.push(titolo); } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stato.codice ? { codice: stato.codice } : null, error: null }) }) }) }),
  }),
}));

const { POST } = await import('@/app/api/agente/aggiungi/route');
const { tipoDaTesto } = await import('@/lib/agenti/aggiungi');

const LAVORO = '11111111-2222-4333-8444-555555555555';
const premi = (corpo: unknown = { lavoro: LAVORO }) =>
  (POST as unknown as (r: Request) => Promise<Response>)(new Request('http://localhost/api/agente/aggiungi', { method: 'POST', body: JSON.stringify(corpo) }));

const prima = {
  nome: 'Ora del Gusto',
  tipo: 'Bar, caffetteria e pasticceria',
  citta: 'Piacenza',
  indirizzo: "Viale Sant'Ambrogio 6/B, 29121 Piacenza",
  campi: [{ voce: 'Telefono del titolare', valore: '333 123 4567', stato: 'da_confermare', fonte: null }],
  sito: { misura: { url: 'https://oradelgusto.it', aperto: true, https: true, titolo: null, descrizione: null, telefonino: true, pagine: 3, funzioni: [], social: {} } },
};

beforeEach(() => {
  stato.agente = { email: 'agente@esempio.it', role: 'seller' };
  stato.lavoro = { stato: 'in_corso', venditore: 'agente@esempio.it', prima };
  stato.iscritte = [];
  stato.esitoIscrizione = { ok: true, id: 'att-1', nuova: true, sito: 'https://oradelgusto.it' };
  stato.codice = 'c'.repeat(64);
  stato.dopo = [];
  stato.avvisi = [];
});

describe('il pulsante «Aggiungi attività»', () => {
  it('iscrive l attività della scheda e dà all agente il link del preventivo', async () => {
    const r = await premi();
    expect(r.status).toBe(201);
    const corpo = (await r.json()) as { data: { nome: string; nuova: boolean; link: string } };
    expect(corpo.data.link).toBe(`https://www.mycity-marketplace.com/preventivo/${'c'.repeat(64)}`);
    expect(stato.iscritte).toHaveLength(1);
    expect(stato.iscritte[0]).toMatchObject({ tipo: 'nuova-attivita', origine: 'agente', nome: 'Ora del Gusto', citta: 'Piacenza', tipo_attivita: 'bar', sito: 'https://oradelgusto.it' });
    expect(JSON.stringify(stato.iscritte[0])).not.toContain('333 123 4567');
    expect(stato.dopo).toEqual([{ dalModulo12: false }]);
    expect(stato.avvisi).toHaveLength(1);
  });

  it('un sito non aperto dal programma, o solo in http, non parte', async () => {
    stato.lavoro = { stato: 'in_corso', venditore: 'agente@esempio.it', prima: { ...prima, sito: { misura: { ...prima.sito.misura, aperto: false } } } };
    await premi();
    expect(stato.iscritte[0].sito).toBeUndefined();
    stato.lavoro = { stato: 'in_corso', venditore: 'agente@esempio.it', prima: { ...prima, sito: { misura: { ...prima.sito.misura, url: 'http://oradelgusto.it' } } } };
    await premi();
    expect(stato.iscritte[1].sito).toBeUndefined();
  });

  it('la scheda di un altro agente non si aggiunge; l admin sì', async () => {
    stato.lavoro = { stato: 'in_corso', venditore: 'altro@esempio.it', prima };
    expect((await premi()).status).toBe(404);
    expect(stato.iscritte).toHaveLength(0);
    stato.agente = { email: 'nicola@esempio.it', role: 'admin' };
    expect((await premi()).status).toBe(201);
  });

  it('premere due volte ridà lo stesso link, senza rimandare al flusso 16 né riavvisare', async () => {
    stato.esitoIscrizione = { ok: true, id: 'att-1', nuova: false, sito: null };
    const r = await premi();
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { link: string } }).data.link).toContain('/preventivo/');
    expect(stato.dopo).toEqual([]);
    expect(stato.avvisi).toEqual([]);
  });

  it('un attività che ha già accettato non si riscrive; un lavoro sbagliato o sconosciuto non fa niente', async () => {
    stato.esitoIscrizione = { ok: false, motivo: 'gia-con-accesso' };
    expect((await premi()).status).toBe(409);
    expect((await premi({ lavoro: 'non-un-codice' })).status).toBe(400);
    stato.lavoro = null;
    expect((await premi()).status).toBe(404);
  });
});

describe('il tipo libero della scheda nei sei tipi del sito', () => {
  it('riconosce i casi comuni e non inventa', () => {
    expect(tipoDaTesto('Bar, caffetteria e pasticceria')).toBe('bar');
    expect(tipoDaTesto('Caffè storico, ristorante e gastronomia')).toBe('ristorante');
    expect(tipoDaTesto('Panificio')).toBe('negozio');
    expect(tipoDaTesto('Palestra di arrampicata')).toBe('servizi');
    expect(tipoDaTesto('Qualcosa di strano')).toBeUndefined();
    expect(tipoDaTesto(null)).toBeUndefined();
  });
});
