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
 * 27/11/2026 02:26 — Nicola: l'agente sceglie l'abbonamento detto dal titolare, e la pagina del negozio si
 * sblocca da sola in quella fascia. Senza abbonamento non si aggiunge niente (400).
 */

const stato = vi.hoisted(() => ({
  agente: { email: 'agente@esempio.it', role: 'seller' as string },
  lavoro: null as null | Record<string, unknown>,
  iscritte: [] as Record<string, unknown>[],
  esitoIscrizione: { ok: true, id: 'att-1', nuova: true, sito: null } as Record<string, unknown>,
  codice: 'c'.repeat(64) as string | null,
  dopo: [] as { dalModulo12: boolean }[],
  avvisi: [] as string[],
  avvisoRotto: false,
  gia: null as null | { id: string; indirizzo: string | null },
  sblocchi: [] as { id: string; fascia: string }[],
  scelte: [] as { id: string; fascia: string }[],
  esitoSblocco: { esito: 'sbloccata', fascia: 'business' } as Record<string, unknown>,
  testiAvvisi: [] as string[],
  portati: [] as { valori: Record<string, unknown>; filtri: Record<string, unknown> }[],
  // 28/11/2026 — Le pagine che il programma apre (finte) e gli indizi che partono per il flusso 16.
  pagine: {} as Record<string, string>,
  indizi: [] as ({ instagram?: string; google_maps?: string } | undefined)[],
}));

vi.mock('@/lib/agenti/rete', async (originale) => ({
  ...(await originale<typeof import('@/lib/agenti/rete')>()),
  leggiPagina: async (url: string) => (stato.pagine[url] ? { ok: true, stato: 200, url, html: stato.pagine[url], errore: null, ms: 1 } : { ok: false, stato: null, url, html: '', errore: 'non si apre', ms: 1 }),
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
  attivitaGiaIscritta: async () => stato.gia,
}));
vi.mock('@/lib/agenzia/dopo-iscrizione', () => ({
  avviaDopoLIscrizione: (_a: unknown, fatto: { nuova: boolean }, _x: unknown, o: { dalModulo12: boolean; indizi?: { instagram?: string; google_maps?: string } }) => { if (fatto.nuova) stato.dopo.push({ dalModulo12: o.dalModulo12 }); stato.indizi.push(o.indizi); },
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: async (titolo: string, testo: string) => { if (stato.avvisoRotto) throw new Error('telegram giù'); stato.avvisi.push(titolo); stato.testiAvvisi.push(testo); } }));
vi.mock('@/lib/agenzia/abbonamento-contanti', () => ({
  sbloccaInContanti: async (_a: unknown, id: string, fascia: string) => { stato.sblocchi.push({ id, fascia }); return stato.esitoSblocco; },
  sbloccoRiuscito: (e: { esito: string }) => e.esito !== 'guasto',
  segnaLaSceltaSulPreventivo: async (_a: unknown, id: string, fascia: string) => { stato.scelte.push({ id, fascia }); return true; },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stato.codice ? { codice: stato.codice } : null, error: null }) }) }),
      // 27/11/2026 — Chi ha portato il cliente (999c): si registra cosa si scrive sul preventivo, e con quali filtri.
      update: (valori: Record<string, unknown>) => {
        const filtri: Record<string, unknown> = {};
        const catena = { eq: (k: string, v: unknown) => { filtri[k] = v; return catena; }, then: (ok: (x: { error: null }) => void) => { stato.portati.push({ valori, filtri }); ok({ error: null }); } };
        return catena;
      },
    }),
  }),
}));

const { POST } = await import('@/app/api/agente/aggiungi/route');
const { tipoDaTesto, nomeNonValido, stessoIndirizzo } = await import('@/lib/agenti/aggiungi');
const { accorciaDettaglio } = await import('@/lib/agenzia/nuova-attivita');

const LAVORO = '11111111-2222-4333-8444-555555555555';
// 28/11/2026 — Il «Sì» porta anche quali servizi gli servono: almeno uno.
const premi = (corpo: unknown = { lavoro: LAVORO, fascia: 'business', servizi: ['sito_web'] }) =>
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
  stato.lavoro = { stato: 'pronta', venditore: 'agente@esempio.it', prima, risultato: {} };
  stato.avvisoRotto = false;
  stato.gia = null;
  stato.iscritte = [];
  stato.esitoIscrizione = { ok: true, id: 'att-1', nuova: true, sito: 'https://oradelgusto.it' };
  stato.codice = 'c'.repeat(64);
  stato.dopo = [];
  stato.avvisi = [];
  stato.testiAvvisi = [];
  stato.sblocchi = [];
  stato.scelte = [];
  stato.esitoSblocco = { esito: 'sbloccata', fascia: 'business' };
  stato.portati = [];
  stato.pagine = {};
  stato.indizi = [];
});

describe('il pulsante «Aggiungi attività»', () => {
  it('iscrive l attività della scheda e dà all agente il link del preventivo', async () => {
    const r = await premi();
    expect(r.status).toBe(201);
    const corpo = (await r.json()) as { data: { nome: string; nuova: boolean; link: string } };
    expect((corpo.data as { avvisato?: boolean }).avvisato).toBe(true);
    expect(corpo.data.link).toBe(`https://www.mycity-marketplace.com/preventivo/${'c'.repeat(64)}`);
    expect(stato.iscritte).toHaveLength(1);
    expect(stato.iscritte[0]).toMatchObject({ tipo: 'nuova-attivita', origine: 'agente', nome: 'Ora del Gusto', citta: 'Piacenza', tipo_attivita: 'bar', sito: 'https://oradelgusto.it' });
    expect(JSON.stringify(stato.iscritte[0])).not.toContain('333 123 4567');
    expect(stato.dopo).toEqual([{ dalModulo12: false }]);
    expect(stato.avvisi).toHaveLength(1);
  });

  it('un sito non aperto dal programma, o solo in http, non parte', async () => {
    stato.lavoro = { stato: 'pronta', venditore: 'agente@esempio.it', risultato: {}, prima: { ...prima, sito: { misura: { ...prima.sito.misura, aperto: false } } } };
    await premi();
    expect(stato.iscritte[0].sito).toBeUndefined();
    stato.lavoro = { stato: 'pronta', venditore: 'agente@esempio.it', risultato: {}, prima: { ...prima, sito: { misura: { ...prima.sito.misura, url: 'http://oradelgusto.it' } } } };
    await premi();
    expect(stato.iscritte[1].sito).toBeUndefined();
  });

  it('il sito e il profilo trovati dall AD si aprono, e arrivano al negozio e al flusso 16 (Raquel Cafè, 28/11)', async () => {
    stato.pagine['https://www.raquelcafe.it/'] = '<title>Raquel Caffè</title><body>Piazza Duomo 23, Piacenza <a href="https://www.instagram.com/raquel_cafe23/">IG</a></body>';
    const senzaSito = { ...prima, nome: 'Raquel 💗 Cafè', indirizzo: 'Piazza Duomo, 23, 29121 Piacenza PC', linkMaps: 'https://maps.app.goo.gl/abc123', sito: { misura: null } };
    stato.lavoro = { stato: 'pronta', venditore: 'agente@esempio.it', prima: senzaSito, risultato: { sito: { url: 'https://www.raquelcafe.it/', livello: 'medio', giudizio: 'x', fonte: null } } };
    await premi();
    expect(stato.iscritte[0].sito).toBe('https://www.raquelcafe.it/');
    expect(stato.indizi[0]).toEqual({ instagram: 'raquel_cafe23', google_maps: 'https://maps.app.goo.gl/abc123' });
  });

  it('un sito trovato solo dal nome entra nel negozio solo se il titolare lo conferma, e solo quello', async () => {
    stato.pagine['https://www.raquelcafe.it/'] = '<title>Raquel Caffè</title><body>Piacenza <a href="https://www.instagram.com/raquel_cafe23/">IG</a></body>';
    const senzaSito = { ...prima, nome: 'Raquel 💗 Cafè', indirizzo: 'Piazza Duomo, 23, 29121 Piacenza PC', sito: { misura: null } };
    const lavoroAd = { stato: 'pronta', venditore: 'agente@esempio.it', prima: senzaSito, risultato: { sito: { url: 'https://www.raquelcafe.it/', livello: 'medio', giudizio: 'x', fonte: null } } };
    stato.lavoro = lavoroAd;
    await premi();
    expect(stato.iscritte[0].sito).toBeUndefined();
    expect(stato.indizi[0]?.instagram).toBeUndefined();
    await premi({ lavoro: LAVORO, fascia: 'business', servizi: ['sito_web'], sitoConfermato: 'https://altro-sito.it/' });
    expect(stato.iscritte[1].sito).toBeUndefined();
    await premi({ lavoro: LAVORO, fascia: 'business', servizi: ['sito_web'], sitoConfermato: 'https://www.raquelcafe.it/' });
    expect(stato.iscritte[2].sito).toBe('https://www.raquelcafe.it/');
    expect(stato.indizi[2]?.instagram).toBe('raquel_cafe23');
  });

  it('un sito dell AD che non porta nome e città non arriva al negozio', async () => {
    stato.pagine['https://omonimo.it/'] = '<title>Raquel Caffè</title><body>Torino</body>';
    stato.lavoro = { stato: 'pronta', venditore: 'agente@esempio.it', prima: { ...prima, nome: 'Raquel 💗 Cafè', sito: { misura: null } }, risultato: { sito: { url: 'https://omonimo.it/', livello: 'medio', giudizio: 'x', fonte: null } } };
    await premi();
    expect(stato.iscritte[0].sito).toBeUndefined();
  });

  it('la scheda di un altro agente non si aggiunge; l admin sì', async () => {
    stato.lavoro = { stato: 'pronta', venditore: 'altro@esempio.it', prima, risultato: {} };
    expect((await premi()).status).toBe(404);
    expect(stato.iscritte).toHaveLength(0);
    stato.agente = { email: 'nicola@esempio.it', role: 'admin' };
    expect((await premi()).status).toBe(201);
  });

  it('premere due volte ridà lo stesso link, senza rimandare al flusso 16 né riavvisare', async () => {
    stato.esitoIscrizione = { ok: true, id: 'att-1', nuova: false, sito: null };
    // Alla seconda pressione la pagina è già sbloccata nella stessa fascia.
    stato.esitoSblocco = { esito: 'gia-sbloccata', fascia: 'business' };
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

describe('dal collaudo del 27/11', () => {
  it('a scheda non finita non si aggiunge niente', async () => {
    stato.lavoro = { stato: 'in_corso', venditore: 'agente@esempio.it', prima };
    const r = await premi();
    expect(r.status).toBe(409);
    expect(stato.iscritte).toHaveLength(0);
  });

  it('un omonimo con un altro indirizzo non si fonde; lo stesso posto sì', async () => {
    stato.gia = { id: 'att-9', indirizzo: 'Via Emilia Pavese 120, Piacenza' };
    const r = await premi();
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: { message: string } }).error.message).toContain('altro indirizzo');
    expect(stato.iscritte).toHaveLength(0);
    stato.gia = { id: 'att-1', indirizzo: "Viale Sant'Ambrogio 6/B, 29121 Piacenza" };
    expect((await premi()).status).toBe(201);
  });

  it('un nome con telefono, email, link o il segnaposto «Attività senza nome» non si iscrive', async () => {
    for (const nome of ['Mario Rossi 333 1234567', 'mario.rossi@gmail.com', 'https://evil.example/x', 'Attività senza nome']) {
      stato.lavoro = { stato: 'pronta', venditore: 'agente@esempio.it', prima: { ...prima, nome }, risultato: {} };
      expect((await premi()).status, nome).toBe(400);
    }
    expect(stato.iscritte).toHaveLength(0);
    expect(nomeNonValido('Bar Sport')).toBeNull();
  });

  it('i caratteri di controllo nel nome si tolgono', async () => {
    stato.lavoro = { stato: 'pronta', venditore: 'agente@esempio.it', prima: { ...prima, nome: 'Ora\u0000 del\nGusto' }, risultato: {} };
    expect((await premi()).status).toBe(201);
    expect(stato.iscritte[0].nome).toBe('Ora del Gusto');
  });

  it('se l avviso a Nicola non parte, la risposta lo dice', async () => {
    stato.avvisoRotto = true;
    const r = await premi();
    expect(r.status).toBe(201);
    expect(((await r.json()) as { data: { avvisato: boolean } }).data.avvisato).toBe(false);
  });

  it('due indirizzi uguali si riconoscono anche scritti diversi', () => {
    expect(stessoIndirizzo("Viale Sant'Ambrogio 6/B", "viale sant ambrogio 6b, 29121 Piacenza")).toBe(true);
    expect(stessoIndirizzo('Via Roma 1', 'Via Emilia 120')).toBe(false);
  });
});

describe('l abbonamento scelto dal titolare sblocca la sua pagina (27/11)', () => {
  it('senza abbonamento, o con uno che non esiste, non si aggiunge niente', async () => {
    expect((await premi({ lavoro: LAVORO })).status).toBe(400);
    expect((await premi({ lavoro: LAVORO, fascia: 'oro' })).status).toBe(400);
    expect(stato.iscritte).toHaveLength(0);
    expect(stato.sblocchi).toHaveLength(0);
  });

  it('la scelta va sul preventivo, la pagina si sblocca in quella fascia e Nicola lo legge', async () => {
    stato.esitoSblocco = { esito: 'sbloccata', fascia: 'premium' };
    const r = await premi({ lavoro: LAVORO, fascia: 'premium', servizi: ['sito_web'] });
    expect(r.status).toBe(201);
    const d = ((await r.json()) as { data: { fascia: string; sbloccata: boolean; giaOnline: boolean } }).data;
    expect(d).toMatchObject({ fascia: 'premium', sbloccata: true, giaOnline: false });
    expect(stato.scelte).toEqual([{ id: 'att-1', fascia: 'premium' }]);
    expect(stato.sblocchi).toEqual([{ id: 'att-1', fascia: 'premium' }]);
    expect(stato.avvisi[0]).toContain('Premium');
    expect(stato.testiAvvisi[0]).toContain('sbloccata col Premium');
    expect(stato.testiAvvisi[0]).toContain('contanti');
  });

  it('premere di nuovo con un altro abbonamento lo cambia e riavvisa; con lo stesso non riavvisa', async () => {
    stato.esitoIscrizione = { ok: true, id: 'att-1', nuova: false, sito: null };
    stato.esitoSblocco = { esito: 'gia-sbloccata', fascia: 'business' };
    await premi();
    expect(stato.avvisi).toEqual([]);
    stato.esitoSblocco = { esito: 'cambiata', fascia: 'premium', da: 'business' };
    const r = await premi({ lavoro: LAVORO, fascia: 'premium', servizi: ['sito_web'] });
    expect(r.status).toBe(200);
    expect(stato.avvisi).toHaveLength(1);
    expect(stato.avvisi[0]).toContain('dal Business al Premium');
  });

  it('un attività che c era già (o fermata per mancato pagamento) e si sblocca adesso: Nicola lo sa (collaudo)', async () => {
    stato.esitoIscrizione = { ok: true, id: 'att-1', nuova: false, sito: null };
    stato.esitoSblocco = { esito: 'sbloccata', fascia: 'business' };
    const r = await premi();
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { avvisoDovuto: boolean; avvisato: boolean } }).data).toMatchObject({ avvisoDovuto: true, avvisato: true });
    expect(stato.avvisi).toHaveLength(1);
    expect(stato.avvisi[0]).toContain('sbloccata di nuovo col Business');
    // Un secondo sblocco dopo un altro fermo ha il suo avviso, non resta muto per la chiave di prima.
    await premi();
    expect(stato.avvisi).toHaveLength(2);
  });

  it('se lo sblocco non riesce, la risposta e l avviso a Nicola lo dicono', async () => {
    stato.esitoSblocco = { esito: 'guasto', dettaglio: 'tabella giù' };
    const r = await premi();
    expect(r.status).toBe(201);
    expect(((await r.json()) as { data: { sbloccata: boolean } }).data.sbloccata).toBe(false);
    expect(stato.testiAvvisi[0]).toContain('NON si è sbloccata');
  });

  it('chi ha già un abbonamento pagato online lo tiene', async () => {
    stato.esitoSblocco = { esito: 'gia-online', fascia: 'base' };
    const r = await premi();
    expect(((await r.json()) as { data: { giaOnline: boolean } }).data.giaOnline).toBe(true);
    expect(stato.testiAvvisi[0]).toContain('pagato online');
  });
});

// 28/11/2026 03:13 — Nicola, dalla pagina dell'agente: «Non sono riuscito ad aggiungere l'attività. Riprova fra
// poco.» La scheda dell'AD descriveva il tipo con più di 60 caratteri, il database ne accetta 60: falliva sempre.
describe('un tipo descritto lungo non ferma il «Sì, aggiungi» (28/11)', () => {
  it('il tipo arriva all iscrizione già sotto i 60 caratteri, tagliato fra due parole', async () => {
    const tipo = 'Bar, caffetteria, pasticceria e gelateria artigianale con laboratorio di produzione propria';
    stato.lavoro = { stato: 'pronta', venditore: 'agente@esempio.it', prima: { ...prima, tipo }, risultato: {} };
    expect((await premi()).status).toBe(201);
    const dettaglio = String(stato.iscritte[0].dettaglio);
    expect(dettaglio.length).toBeLessThanOrEqual(60);
    expect(tipo.startsWith(dettaglio)).toBe(true);
    expect(dettaglio).not.toMatch(/[\s,]$|\s(e|con|di)$/);
    // Il tipo del sito si capisce dalla descrizione intera, non da quella accorciata.
    expect(stato.iscritte[0].tipo_attivita).toBe('bar');
  });

  it('accorciaDettaglio: corto resta uguale, lungo senza spazi si taglia a 60, un emoji non si spezza', () => {
    expect(accorciaDettaglio('Panificio')).toBe('Panificio');
    expect(accorciaDettaglio('   ')).toBeUndefined();
    expect(accorciaDettaglio(null)).toBeUndefined();
    expect(accorciaDettaglio('x'.repeat(90))).toBe('x'.repeat(60));
    const conEmoji = `${'a'.repeat(59)}🍰🍰`;
    const corto = accorciaDettaglio(conEmoji)!;
    expect(Array.from(corto).length).toBe(60);
    expect(corto.endsWith('🍰')).toBe(true);
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

describe('chi ha portato il cliente resta scritto sul preventivo (27/11, migrazione 999c)', () => {
  it('al «Sì, aggiungi» la scheda e l email dell agente vanno sul preventivo ancora aperto', async () => {
    expect((await premi()).status).toBe(201);
    expect(stato.portati).toEqual([
      { valori: { lavoro: LAVORO, agente_email: 'agente@esempio.it' }, filtri: { seller_id: 'att-1', stato: 'aperto' } },
      // 28/11/2026 — e quali servizi gli servono (999h).
      { valori: { servizi_scelti: ['sito_web'], nota_agente: null }, filtri: { seller_id: 'att-1', stato: 'aperto' } },
    ]);
  });

  it('se la scrittura non riesce (999c non applicata) l agente ha il suo link lo stesso', async () => {
    const { segnaChiHaPortatoIlCliente } = await import('@/lib/agenti/aggiungi');
    const rotto = { from: () => ({ update: () => { throw new Error('column "lavoro" does not exist'); } }) } as unknown as Parameters<typeof segnaChiHaPortatoIlCliente>[0];
    expect(await segnaChiHaPortatoIlCliente(rotto, 'att-1', { lavoro: LAVORO, agenteEmail: 'agente@esempio.it' })).toBe(false);
    expect(await segnaChiHaPortatoIlCliente(rotto, 'att-1', { lavoro: 'non-un-codice', agenteEmail: 'agente@esempio.it' })).toBe(false);
  });
});

// 28/11/2026, 01:10 e 01:25 — Nicola: il lavoro nasce dall'abbonamento «ma anche al servizio di cui ha bisogno»,
// scelto dall'agente fra i quattro servizi prima di mandare il link. Senza servizi il server rifiuta; uno fuori elenco anche.
describe('quali servizi gli servono (28/11, migrazione 999h)', () => {
  it('senza servizi, con un elenco vuoto o con un servizio fuori elenco il server rifiuta e non iscrive niente', async () => {
    expect((await premi({ lavoro: LAVORO, fascia: 'business' })).status).toBe(400);
    expect((await premi({ lavoro: LAVORO, fascia: 'business', servizi: [] })).status).toBe(400);
    expect((await premi({ lavoro: LAVORO, fascia: 'business', servizi: ['volantini'] })).status).toBe(400);
    expect((await premi({ lavoro: LAVORO, fascia: 'business', servizi: ['sito_web', 'prenotazioni'] })).status).toBe(400);
    expect(stato.iscritte).toHaveLength(0);
  });

  it('una nota troppo lunga o con un telefono si rifiuta; una nota giusta va sul preventivo e nell avviso a Nicola', async () => {
    expect((await premi({ lavoro: LAVORO, fascia: 'business', servizi: ['analisi'], nota: 'x'.repeat(201) })).status).toBe(400);
    expect((await premi({ lavoro: LAVORO, fascia: 'business', servizi: ['analisi'], nota: 'chiamalo al 333 123 4567' })).status).toBe(400);
    expect(stato.iscritte).toHaveLength(0);
    const r = await premi({ lavoro: LAVORO, fascia: 'business', servizi: ['analisi', 'sito_web'], nota: 'vuole far vedere la sala per le feste' });
    expect(r.status).toBe(201);
    // L'ordine dei servizi è quello del listino, qualunque sia l'ordine dei clic.
    expect(stato.portati.at(-1)?.valori).toEqual({ servizi_scelti: ['sito_web', 'analisi'], nota_agente: 'vuole far vedere la sala per le feste' });
    expect(JSON.stringify(stato.testiAvvisi)).toMatch(/Gestione sito web, Analisi di mercato.*sala per le feste/);
  });
});
