// @ts-nocheck — dati finti senza tipi, come le altre prove della scheda del venditore.
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * LE ROTTE DELLA SCHEDA CON IL SITO E I SOCIAL — 28/11/2026 (collaudo: nessuna prova chiamava le rotte).
 *  · /api/agente/analizza usa il campo del venditore: il sito che porta nome e città diventa il sito della scheda,
 *    il profilo entra come trovato, un sito sbagliato resta un indizio e all'AD non arriva come vero;
 *  · /api/agente/stato, a scheda pronta, apre il sito che l'AD ha visto;
 *  · avviaDopoLIscrizione passa gli indizi al flusso 16.
 */

const stato = vi.hoisted(() => ({
  pagine: {} as Record<string, string>,
  lavori: [] as { prima: unknown; job: { dati: Record<string, unknown> } }[],
  lavoro: null as null | Record<string, unknown>,
  flusso: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/agenti/rete', async (originale) => ({
  ...(await originale<typeof import('@/lib/agenti/rete')>()),
  leggiPagina: async (url: string) => (stato.pagine[url] ? { ok: true, stato: 200, url, html: stato.pagine[url], errore: null, ms: 1 } : { ok: false, stato: null, url, html: '', errore: 'non si apre', ms: 1 }),
}));
vi.mock('@/lib/agenti/rotta', () => ({
  conAgente: (_f: unknown, gestore: (c: Record<string, unknown>) => unknown) => (req: Request) => gestore({ req, email: 'agente@esempio.it', profile: { role: 'seller' }, user: { id: 'u1' } }),
}));
vi.mock('@/lib/agenti/link', async (originale) => ({
  ...(await originale<typeof import('@/lib/agenti/link')>()),
  risolviLink: async () => ({ nome: 'Raquel 💗 Cafè', indirizzo: 'Piazza Duomo, 23, 29121 Piacenza PC', lat: 45.05, lon: 9.69, idLuogo: null, link: 'https://www.google.com/maps/place/Raquel' }),
}));
vi.mock('@/lib/agenti/osm', () => ({
  cercaOsm: async () => ({ lat: 45.05, lon: 9.69, indirizzo: null, luogo: null, concorrenti: [], concorrentiContati: 0, raggio: 300, avvisi: [] }),
}));
vi.mock('@/lib/agenti/n8n', () => ({
  avviaLavoro: async (_l: string, _v: string, _n: string, prima: unknown, job: { dati: Record<string, unknown> }) => { stato.lavori.push({ prima, job }); return { ok: true }; },
  leggiLavoro: async () => stato.lavoro,
}));
vi.mock('@/lib/agenzia/nuovo-cliente-n8n', () => ({ inviaNuovaAttivitaAlFlusso: async (a: Record<string, unknown>) => { stato.flusso.push(a); return 'inviato'; } }));
vi.mock('@/lib/agenzia/sito-pagespeed', () => ({ analizzaSitoDopoLaRisposta: () => {} }));

const { POST: analizza } = await import('@/app/api/agente/analizza/route');
const { GET: chiediStato } = await import('@/app/api/agente/stato/route');
const { avviaDopoLIscrizione } = await import('@/lib/agenzia/dopo-iscrizione');

const premi = async (corpo: unknown) => {
  const r = await analizza(new Request('http://localhost/api/agente/analizza', { method: 'POST', body: JSON.stringify(corpo) }));
  return (await r.json()).data;
};
const PAGINA = (titolo: string) => `<title>${titolo}</title><body>Piazza Duomo 23, Piacenza <a href="https://www.instagram.com/raquel_cafe23/">IG</a></body>`;

beforeEach(() => { stato.pagine = {}; stato.lavori = []; stato.lavoro = null; stato.flusso = []; });

describe('/api/agente/analizza col campo del venditore', () => {
  it('il sito copiato dalla scheda Google diventa il sito della scheda, coi profili che collega', async () => {
    // Il nome sta solo nel logo, come capita spesso.
    stato.pagine['https://www.raquelcafe.it/'] = PAGINA('Home').replace('<body>', '<body><img src="logo.png" alt="Raquel Cafè">');
    const d = await premi({ testo: 'https://maps.app.goo.gl/x', canale: 'www.raquelcafe.it' });
    expect(d.scheda.sito.misura?.url).toBe('https://www.raquelcafe.it/');
    expect(d.scheda.social.find((p) => p.canale === 'Instagram')).toMatchObject({ stato: 'trovato', origine: 'sito' });
    expect(stato.lavori[0].job.dati.dal_venditore).toMatchObject({ sito: 'https://www.raquelcafe.it/' });
  });

  it('il profilo scritto dal venditore entra come trovato, e fa provare raquelcafe23.it', async () => {
    stato.pagine['https://raquelcafe23.it/'] = PAGINA('Raquel Cafè');
    const d = await premi({ testo: 'https://maps.app.goo.gl/x', canale: '@raquel_cafe23' });
    expect(d.scheda.sito.misura?.url).toBe('https://raquelcafe23.it/');
    expect(d.scheda.social.find((p) => p.canale === 'Instagram')?.stato).toBe('trovato');
  });

  it('un sito che non è del locale resta un indizio, e all’AD non arriva come vero', async () => {
    stato.pagine['https://altrobar.it/'] = '<title>Bar Sport</title><body>Via Emilia 3, Piacenza</body>';
    const d = await premi({ testo: 'https://maps.app.goo.gl/x', canale: 'altrobar.it' });
    expect(d.scheda.sito.misura?.aperto).toBeFalsy();
    expect(d.scheda.campi.find((c) => c.voce === 'Sito scritto da te')).toBeTruthy();
    expect(stato.lavori[0].job.dati.dal_venditore.sito).toBeNull();
  });

  it('senza il campo la scheda parte come prima', async () => {
    const d = await premi({ testo: 'https://maps.app.goo.gl/x' });
    expect(d.lavoro).toBeTruthy();
    expect(stato.lavori[0].job.dati.dal_venditore).toBeNull();
  });
});

describe('/api/agente/stato a scheda pronta', () => {
  it('apre il sito che l’AD ha visto e lo mette nella scheda', async () => {
    stato.pagine['https://www.raquelcafe.it/'] = PAGINA('Raquel Caffè');
    const prima = { nome: 'Raquel 💗 Cafè', citta: 'Piacenza', indirizzo: 'Piazza Duomo, 23, 29121 Piacenza PC', campi: [], social: [], sito: { misura: null }, attenzione: [], avvisi: [] };
    stato.lavoro = { stato: 'pronta', venditore: 'agente@esempio.it', prima, risultato: { sito: { url: 'https://www.raquelcafe.it/', livello: 'medio', giudizio: 'x', fonte: null } }, avvisi: [] };
    const r = await chiediStato(new Request('http://localhost/api/agente/stato?lavoro=11111111-2222-4333-8444-555555555555'));
    const d = (await r.json()).data;
    expect(d.scheda.sito.misura?.url).toBe('https://www.raquelcafe.it/');
  });
});

describe('dopo l’iscrizione', () => {
  it('gli indizi arrivano al flusso 16', async () => {
    let lavoro: () => Promise<void> = async () => {};
    avviaDopoLIscrizione({}, { id: 'a1', nuova: true, sito: null }, { tipo: 'nuova-attivita', origine: 'agente', nome: 'Raquel Cafè' },
      { dalModulo12: false, dopo: (fn) => { lavoro = fn; }, indizi: { instagram: 'raquel_cafe23', google_maps: 'https://maps.app.goo.gl/x' } });
    await lavoro();
    expect(stato.flusso[0].indizi).toEqual({ instagram: 'raquel_cafe23', google_maps: 'https://maps.app.goo.gl/x' });
  });
});
