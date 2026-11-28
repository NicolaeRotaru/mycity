import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nuovoDb, supabaseFinto, type DbFinto } from './_supabase-finto';

/**
 * IL SITO, IL PIANO E L'ANALISI NASCONO CON L'ORDINE — 28/11/2026 (Nicola, verso le 00:55).
 *
 * «Fai in modo che una volta che il cliente accetta viene creato in automatico, in base all'abbonamento, il suo sito
 * web, il piano editoriale, l'analisi di business». Queste prove dicono:
 *  ① all'accettazione partono TRE lavori per l'AD (piano, sito, analisi), e la fascia decide le pagine del sito e le
 *     parti dell'analisi;
 *  ② una risposta dell'AD con un prezzo, un dato inventato o un dato di Google si scarta; una giusta entra «pronta»;
 *  ③ se n8n non risponde (o la 999h non c'è) l'accettazione va lo stesso e il pezzo resta «da collegare»;
 *  ④ il titolare vede solo il SUO lavoro, mai quello di un altro né l'email dell'agente;
 *  ⑤ il pulsante «richiedi» funziona anche su un ordine nato prima, come quello di prova del 27/11.
 */

const SELLER = '0de1905e-7000-4000-8000-0000000000aa';
const ALTRO = '0de1905e-7000-4000-8000-0000000000bb';
const CODICE = 'b'.repeat(64);
const LAVORO = '11111111-2222-4333-8444-555555555555';
const VISITA = '2026-12-03T09:00:00.000Z';

const stato = vi.hoisted(() => ({
  db: null as unknown as DbFinto,
  n8nCollegato: true,
  avviati: [] as { lavoro: string; venditore: string; nome: string; prima: Record<string, unknown>; job: Record<string, unknown> }[],
  esitoAvvio: { ok: true } as { ok: boolean; errore?: string },
  lavori: {} as Record<string, unknown>,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://www.mycity-marketplace.com' } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/agenzia/pagamento-servizi', async (originale) => ({
  ...(await originale<typeof import('@/lib/agenzia/pagamento-servizi')>()),
  pagamentoOnlineAttivo: () => false,
}));
vi.mock('@/lib/agenzia/abbonamento-contanti', async (originale) => ({
  ...(await originale<typeof import('@/lib/agenzia/abbonamento-contanti')>()),
  sbloccaInContanti: vi.fn(async (_a: unknown, _id: string, fascia: string) => ({ esito: 'gia-sbloccata', fascia })),
}));
vi.mock('@/lib/agenti/n8n', () => ({
  adCollegato: () => stato.n8nCollegato,
  avviaLavoro: vi.fn(async (lavoro: string, venditore: string, nome: string, prima: Record<string, unknown>, job: Record<string, unknown>) => {
    stato.avviati.push({ lavoro, venditore, nome, prima, job });
    return stato.esitoAvvio;
  }),
  leggiLavoro: vi.fn(async (lavoro: string) => stato.lavori[lavoro] ?? { stato: 'sconosciuto', errore: 'n8n non risponde' }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    ...supabaseFinto(stato.db),
    auth: { admin: { updateUserById: async (id: string) => ({ data: { user: { id } }, error: null }), generateLink: async () => ({ data: { properties: { action_link: 'https://supabase.test/v', hashed_token: 'h' } }, error: null }) } },
  }),
}));

const { accettaPreventivoColCodice, leggiPreventivoColCodice } = await import('@/lib/agenzia/preventivo-col-codice');
const { getAdminSupabase } = await import('@/lib/supabase/server');
const { VENDITORE_DEI_PIANI, COMPITO_PIANO } = await import('@/lib/agenzia/piano-completo-ad');
const { COMPITO_SITO, PAGINE_PER_FASCIA, sitoDallaRisposta } = await import('@/lib/agenzia/sito-dell-ordine-ad');
const { COMPITO_ANALISI, analisiDallaRisposta, partiDaScrivere } = await import('@/lib/agenzia/analisi-dell-ordine-ad');
const { aggiornaIlPezzo, chiediIlPezzo } = await import('@/lib/agenzia/pezzi-dell-ordine');
const { lavoroDallOrdine } = await import('@/lib/agenzia/lavoro-dell-ordine');
const { parteDellOrdine } = await import('@/lib/agenzia/lavoro-consegnato/quale-parte');
const { notifyAdmins } = await import('@/lib/stripe/webhook/comune');
const { TETTI_FLUSSO_14 } = await import('@/lib/agenzia/piano-completo-ad');

const ordini = () => (stato.db.tabelle.ordini_sdg ?? []) as Record<string, unknown>[];
const lavoroDi = (compito: string) => stato.avviati.find((a) => a.job.compito === compito);

/** Le colonne che la 999h aggiunge, coi loro DEFAULT: il database le mette da solo a ogni ordine nuovo. */
const PREDEFINITI_999H = { sito: null, sito_stato: 'da_collegare', lavoro_sito: null, sito_errore: null, sito_il: null, analisi: null, analisi_stato: 'da_collegare', lavoro_analisi: null, analisi_errore: null, analisi_il: null };

function preparaDb() {
  const db = nuovoDb();
  db.predefiniti = { ordini_sdg: PREDEFINITI_999H };
  db.tabelle.profiles = [{ id: SELLER, role: 'seller', store_name: 'Caffè di Prova', store_address: 'Piazza Duomo 8, Piacenza', city: 'Piacenza', business_type: 'bar', business_type_detail: 'Bar e caffetteria', visibile_senza_abbonamento: false }];
  db.tabelle.preventivi_con_codice = [{ seller_id: SELLER, codice: CODICE, stato: 'aperto', fascia_scelta: 'business', creato_il: '2026-11-27T10:00:00Z', accettato_il: null, condizioni_accettate_il: null, lavoro: LAVORO, agente_email: 'agente@esempio.it', visita_il: null }];
  db.tabelle.abbonamenti_servizi = [];
  db.tabelle.schede_clienti = [];
  return db;
}

async function accetta(fascia: 'base' | 'business' | 'premium', servizi?: ('foto_video' | 'sito_web' | 'social' | 'analisi')[]) {
  stato.db.tabelle.preventivi_con_codice[0].fascia_scelta = fascia;
  const preventivo = await leggiPreventivoColCodice(CODICE);
  return accettaPreventivoColCodice({ preventivo: preventivo!, codice: CODICE, email: 'titolare@esempio.it', fascia, visita: VISITA, servizi });
}

/** Aspetta che i lavori dopo la risposta abbiano finito di partire. */
const aspettaILavori = (quanti: number) => vi.waitFor(() => expect(stato.avviati.length).toBeGreaterThanOrEqual(quanti)).then(() => new Promise((r) => setTimeout(r, 20)));

const SEZIONE = { titolo: 'Chi siamo', testo: 'Un bar nel centro della città, per la colazione e per la pausa a metà giornata.', stato: 'da_confermare' };
const sitoBuono = (pagine: number) => ({
  sottotitolo: 'Bar e caffetteria in centro',
  pagine: Array.from({ length: pagine }, (_, i) => ({ titolo: i === 0 ? 'Home' : `Pagina ${i + 1}`, percorso: i === 0 ? '/' : `/pagina-${i + 1}`, sezioni: [{ ...SEZIONE }] })),
  da_confermare: [{ voce: 'Orari di apertura', perche: 'non li abbiamo: li scrive il titolare' }],
  fonti: ['https://www.openstreetmap.org/node/1'],
  note: ['Foto della vetrina e del bancone alla visita'],
});
const conTesto = (testo: string, pagine = 3) => {
  const s = sitoBuono(pagine);
  s.pagine[0].sezioni = [{ ...SEZIONE, testo }];
  return s;
};

const analisiBuona = (fascia: 'base' | 'business' | 'premium') => ({
  sintesi: ['Il locale è in centro, in una zona di passaggio tutto il giorno.'],
  parti: partiDaScrivere(fascia).map((parte) => ({ parte, frasi: ['Lo leggiamo insieme alla prima visita.'], fonti: [] as string[] })),
  prime_mosse: [
    { cosa: 'Sistemare la vetrina su MyCity', perche: 'è la prima cosa che vede chi cerca un bar in zona' },
    { cosa: 'Pubblicare le prime foto del locale', perche: 'oggi online non ci sono foto recenti' },
    { cosa: 'Preparare il primo mese di post', perche: 'serve una presenza costante sui social' },
  ],
  da_confermare: ['I giorni di chiusura del locale'],
});

beforeEach(() => {
  stato.db = preparaDb();
  stato.n8nCollegato = true;
  stato.avviati = [];
  stato.esitoAvvio = { ok: true };
  stato.lavori = {};
});

describe('① all accettazione partono tre lavori, e la fascia decide', () => {
  it.each([['base', 1], ['business', 3], ['premium', 5]] as const)('col %s partono piano, sito e analisi; il sito ha %i pagine', async (fascia, pagine) => {
    const esito = await accetta(fascia);
    expect(esito.ok).toBe(true);
    await aspettaILavori(3);
    expect(stato.avviati).toHaveLength(3);
    const [piano, sito, analisi] = [lavoroDi(COMPITO_PIANO), lavoroDi(COMPITO_SITO), lavoroDi(COMPITO_ANALISI)];
    expect(piano && sito && analisi).toBeTruthy();
    // Tutti e tre sul flusso 14 così com'è, col «venditore» di sistema di SDG: mai l'email dell'agente o del titolare.
    for (const a of stato.avviati) {
      expect(a.venditore).toBe(VENDITORE_DEI_PIANI);
      expect(JSON.stringify(a)).not.toMatch(/agente@esempio\.it|titolare@esempio\.it|2026-12-03T09/);
      expect(JSON.stringify({ compito: a.job.compito, dati: a.job.dati, schema: a.job.schema }).length).toBeLessThanOrEqual(TETTI_FLUSSO_14.richiesta);
    }
    const datiSito = sito!.job.dati as { abbonamento: { pagine: number; fascia: string } };
    expect(datiSito.abbonamento).toMatchObject({ fascia, pagine });
    expect(PAGINE_PER_FASCIA[fascia]).toBe(pagine);
    const datiAnalisi = analisi!.job.dati as { abbonamento: { parti: { parte: string }[] } };
    expect(datiAnalisi.abbonamento.parti.map((p) => p.parte)).toEqual(partiDaScrivere(fascia));
    // L'ordine sa con quale lavoro ha chiesto ognuno dei due pezzi.
    expect(ordini()[0]).toMatchObject({ fascia, sito_stato: 'in_corso', lavoro_sito: sito!.lavoro, analisi_stato: 'in_corso', lavoro_analisi: analisi!.lavoro });
  });

  it('il Base non chiede le parti che non comprende; il Premium ne chiede di più', () => {
    expect(partiDaScrivere('base')).not.toContain('ricerche');
    expect(partiDaScrivere('base')).not.toContain('concorrenti_web');
    expect(partiDaScrivere('premium').length).toBeGreaterThan(partiDaScrivere('base').length);
  });
});

describe('② la risposta dell AD entra solo se rispetta le regole', () => {
  it('una bozza giusta, con le pagine della fascia, entra «pronta» e non è pubblicata', async () => {
    await accetta('business');
    await aspettaILavori(3);
    const o = ordini()[0] as Parameters<typeof aggiornaIlPezzo>[1];
    stato.lavori[String(o.lavoro_sito)] = { stato: 'pronta', venditore: VENDITORE_DEI_PIANI, risultato: sitoBuono(3) };
    const dopo = await aggiornaIlPezzo(getAdminSupabase(), o, 'sito');
    expect(dopo.sito_stato).toBe('pronto');
    expect(ordini()[0].sito_stato).toBe('pronto');
    expect(ordini()[0].sito).toMatchObject({ fascia: 'business', pubblicata: false });
    expect((ordini()[0].sito as { pagine: unknown[] }).pagine).toHaveLength(3);
  });

  it.each([
    ['un prezzo', 'Il cappuccino lo trovi a 1,50 € tutte le mattine, con la brioche appena sfornata.'],
    ['un prezzo in parole', 'La colazione completa costa solo 3 euro, tutti i giorni della settimana.'],
    ['un telefono inventato', 'Per prenotare un tavolo chiamaci al 0523 123456, ti rispondiamo subito.'],
    ['un orario inventato', 'Siamo aperti tutti i giorni dalle 7.30 fino a sera, anche la domenica mattina.'],
    ['un voto di Google', 'I clienti ci danno 4,6 su Google con più di 120 recensioni, grazie a tutti.'],
    ['un nome di persona', 'Ti accoglie Mario Rossi, che ha aperto il locale dieci anni fa in centro.'],
    ['un indirizzo web', 'Trovi tutte le novità del locale sul nostro sito caffediprova.it ogni settimana.'],
  ])('una bozza con %s si scarta intera', (_cosa, testo) => {
    const esito = sitoDallaRisposta(conTesto(testo), 'business', 'Caffè di Prova');
    expect(esito.ok).toBe(false);
  });

  it('una bozza col numero sbagliato di pagine si scarta: una pagina nel Business, tre nel Base', () => {
    expect(sitoDallaRisposta(sitoBuono(1), 'business', 'Caffè di Prova')).toMatchObject({ ok: false, motivo: expect.stringContaining('1 pagine invece di 3') });
    expect(sitoDallaRisposta(sitoBuono(3), 'base', 'Caffè di Prova')).toMatchObject({ ok: false });
    expect(sitoDallaRisposta(sitoBuono(1), 'base', 'Caffè di Prova').ok).toBe(true);
    expect(sitoDallaRisposta(sitoBuono(5), 'premium', 'Caffè di Prova').ok).toBe(true);
  });

  it('una bozza con una sezione non «da confermare» o con una fonte di Google si scarta', () => {
    const s = sitoBuono(3) as unknown as { pagine: { sezioni: { stato: string }[] }[]; fonti: string[] };
    s.pagine[1].sezioni[0].stato = 'confermato';
    expect(sitoDallaRisposta(s, 'business', 'Caffè di Prova').ok).toBe(false);
    const g = sitoBuono(3);
    g.fonti = ['https://www.google.com/maps/place/caffe'];
    expect(sitoDallaRisposta(g, 'business', 'Caffè di Prova').ok).toBe(false);
  });

  it('una bozza scartata lascia l ordine in «errore» col motivo, e il sito resta vuoto', async () => {
    await accetta('business');
    await aspettaILavori(3);
    const o = ordini()[0] as Parameters<typeof aggiornaIlPezzo>[1];
    stato.lavori[String(o.lavoro_sito)] = { stato: 'pronta', venditore: VENDITORE_DEI_PIANI, risultato: conTesto('Il cappuccino lo trovi a 1,50 € tutte le mattine, con la brioche.') };
    await aggiornaIlPezzo(getAdminSupabase(), o, 'sito');
    expect(ordini()[0]).toMatchObject({ sito_stato: 'errore', sito: null });
    expect(String(ordini()[0].sito_errore)).toMatch(/prezzo/);
  });

  it('un analisi giusta entra; con un voto di Google, una fonte di Google o una parte fuori fascia si scarta', async () => {
    expect(analisiDallaRisposta(analisiBuona('base'), 'base', 'Caffè di Prova').ok).toBe(true);
    expect(analisiDallaRisposta(analisiBuona('premium'), 'premium', 'Caffè di Prova').ok).toBe(true);

    const voto = analisiBuona('base');
    voto.parti[0].frasi = ['Su Google il locale ha 4,6 stelle e 120 recensioni.'];
    expect(analisiDallaRisposta(voto, 'base', 'Caffè di Prova').ok).toBe(false);

    const fonte = analisiBuona('base');
    fonte.parti[0].fonti = ['https://maps.google.com/?cid=123'];
    expect(analisiDallaRisposta(fonte, 'base', 'Caffè di Prova').ok).toBe(false);

    // Il Business ha «Cosa cerca la gente»: se arriva nel Base, il Base l'avrebbe senza averla comprata.
    expect(analisiDallaRisposta(analisiBuona('business'), 'base', 'Caffè di Prova')).toMatchObject({ ok: false, motivo: expect.stringContaining('non comprende') });
    // E una parte che manca non passa in silenzio.
    expect(analisiDallaRisposta(analisiBuona('base'), 'premium', 'Caffè di Prova')).toMatchObject({ ok: false, motivo: expect.stringContaining('mancano') });

    const persona = analisiBuona('base');
    persona.sintesi = ['Il locale lo porta avanti Giulia Bianchi da dieci anni.'];
    expect(analisiDallaRisposta(persona, 'base', 'Caffè di Prova').ok).toBe(false);

    const prezzo = analisiBuona('base');
    prezzo.prime_mosse[0].perche = 'un menu del giorno a 12 euro porta clienti a pranzo';
    expect(analisiDallaRisposta(prezzo, 'base', 'Caffè di Prova').ok).toBe(false);
  });

  it('una risposta che non viene dal «venditore» di SDG non entra', async () => {
    await accetta('base');
    await aspettaILavori(3);
    const o = ordini()[0] as Parameters<typeof aggiornaIlPezzo>[1];
    stato.lavori[String(o.lavoro_analisi)] = { stato: 'pronta', venditore: 'agente@esempio.it', risultato: analisiBuona('base') };
    await aggiornaIlPezzo(getAdminSupabase(), o, 'analisi');
    expect(ordini()[0].analisi_stato).toBe('in_corso');
    expect(ordini()[0].analisi).toBeNull();
  });
});

describe('③ se l AD non risponde, l accettazione va lo stesso', () => {
  it('n8n giù: il titolare ha la sua conferma, sito e analisi restano «da collegare» col motivo', async () => {
    stato.esitoAvvio = { ok: false, errore: 'n8n non risponde' };
    const esito = await accetta('premium');
    expect(esito.ok).toBe(true);
    expect(stato.db.tabelle.preventivi_con_codice[0].stato).toBe('accettato');
    await aspettaILavori(3);
    await vi.waitFor(() => expect(ordini()[0].sito_stato).toBe('da_collegare'));
    await vi.waitFor(() => expect(ordini()[0].analisi_stato).toBe('da_collegare'));
    expect(ordini()[0]).toMatchObject({ lavoro_sito: null, lavoro_analisi: null });
    expect(String(ordini()[0].sito_errore)).toMatch(/n8n non risponde/);
  });

  it('collegamento con l AD spento: nessun lavoro parte, l accettazione va', async () => {
    stato.n8nCollegato = false;
    const esito = await accetta('base');
    expect(esito.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(stato.avviati).toHaveLength(0);
    expect(ordini()[0]).toMatchObject({ sito_stato: 'da_collegare', analisi_stato: 'da_collegare' });
  });

  it('un lavoro che lancia un errore non ferma l accettazione', async () => {
    const n8n = await import('@/lib/agenti/n8n');
    vi.mocked(n8n.avviaLavoro).mockImplementation(async () => { throw new Error('boom'); });
    try {
      const esito = await accetta('business');
      expect(esito.ok).toBe(true);
      await new Promise((r) => setTimeout(r, 50));
      expect(ordini()).toHaveLength(1);
    } finally {
      vi.mocked(n8n.avviaLavoro).mockImplementation(async (lavoro: string, venditore: string, nome: string, prima: unknown, job: Record<string, unknown>) => {
        stato.avviati.push({ lavoro, venditore, nome, prima: prima as Record<string, unknown>, job });
        return stato.esitoAvvio;
      });
    }
  });

  it('prima della 999h: l ordine nasce col piano come oggi, sito e analisi dicono «manca la migrazione 999h»', async () => {
    stato.db.predefiniti = {};
    stato.db.colonneMancanti = { ordini_sdg: Object.keys(PREDEFINITI_999H) };
    const esito = await accetta('business');
    expect(esito.ok).toBe(true);
    await aspettaILavori(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(ordini()).toHaveLength(1);
    expect(stato.avviati.map((a) => a.job.compito)).toEqual([COMPITO_PIANO]);
    expect(await chiediIlPezzo(String(ordini()[0].id), 'sito')).toEqual({ esito: 'guasto', dettaglio: 'manca la migrazione 999h' });
    // E il titolare vede il suo piano, coi due pezzi «in preparazione».
    const visto = await lavoroDallOrdine(SELLER);
    expect(visto).toMatchObject({ sito: { stato: 'lo_stiamo_preparando', bozza: null }, analisi: { stato: 'lo_stiamo_preparando', analisi: null } });
    expect(visto?.piano.piano).toBeTruthy();
  });
});

describe('④ il titolare vede solo il suo lavoro', () => {
  function dueOrdini() {
    stato.db.tabelle.ordini_sdg = [
      { id: 'o-mio', seller_id: SELLER, nome_attivita: 'Caffè di Prova', fascia: 'base', piano: { contenuti: [] }, piano_completo_stato: 'pronto', agente_email: 'agente@esempio.it', lavoro: LAVORO, ...PREDEFINITI_999H, sito: { ...sitoDallaRispostaOk(1), nota: 'MIO' }, sito_stato: 'pronto' },
      { id: 'o-altro', seller_id: ALTRO, nome_attivita: 'Bar Altrui', fascia: 'premium', piano: { contenuti: [] }, piano_completo_stato: 'pronto', agente_email: 'altro@esempio.it', ...PREDEFINITI_999H, sito: { ...sitoDallaRispostaOk(5), nota: 'ALTRUI' }, sito_stato: 'pronto', analisi: { segreto: 'ALTRUI' }, analisi_stato: 'pronto' },
    ];
  }
  const sitoDallaRispostaOk = (n: number) => {
    const e = sitoDallaRisposta(sitoBuono(n), n === 1 ? 'base' : 'premium', 'x');
    if (!e.ok) throw new Error(e.motivo);
    return e.sito;
  };

  it('legge solo la riga del negozio entrato, senza agente, lavori di n8n o motivi', async () => {
    dueOrdini();
    const mio = await lavoroDallOrdine(SELLER);
    expect(mio?.nomeAttivita).toBe('Caffè di Prova');
    expect(mio?.sito.stato).toBe('pronto');
    // 28/11 14:10 — il sito pronto è online: il titolare riceve l'indirizzo intero, col dominio del marketplace.
    expect(mio?.sito.indirizzo).toMatch(/^https:\/\/www\.mycity-marketplace\.com\/sito\/caffe-di-prova-[0-9a-f]{8}$/);
    const testo = JSON.stringify(mio);
    expect(testo).toContain('MIO');
    expect(testo).not.toMatch(/ALTRUI|Bar Altrui|agente@esempio\.it|altro@esempio\.it|lavoro_sito|sito_errore/);
    expect(testo).not.toContain(LAVORO);
    expect(mio?.analisi).toEqual({ stato: 'lo_stiamo_preparando', analisi: null });
  });

  it('un negozio senza ordine non riceve niente, nemmeno chiedendo con un id storto', async () => {
    dueOrdini();
    expect(await lavoroDallOrdine('0de1905e-7000-4000-8000-0000000000cc')).toBeNull();
    expect(await lavoroDallOrdine('')).toBeNull();
    expect(await lavoroDallOrdine(`${SELLER}' OR 1=1`)).toBeNull();
  });

  it('la rotta del titolare prende l id dall accesso, mai dalla richiesta', async () => {
    dueOrdini();
    vi.resetModules();
    vi.doMock('@/lib/api/middleware', () => ({
      withSellerAnchePendingRateLimit: (_o: unknown, h: (c: { user: { id: string } }) => Promise<Response>) => () => h({ user: { id: ALTRO } }),
    }));
    const { GET } = await import('@/app/api/seller/lavoro-consegnato/route');
    const r = await (GET as unknown as (req: Request) => Promise<Response>)(new Request(`http://x/api/seller/lavoro-consegnato?seller_id=${SELLER}`, { headers: { 'x-seller-id': SELLER } }));
    const corpo = await r.json();
    expect(corpo.data.ordine.nomeAttivita).toBe('Bar Altrui');
    expect(JSON.stringify(corpo)).not.toContain('MIO');
    expect(JSON.stringify(corpo)).not.toContain('altro@esempio.it');
    vi.doUnmock('@/lib/api/middleware');
  });
});

describe('⑤ il pulsante «richiedi» funziona su un ordine nato prima', () => {
  it('l ordine di prova del 27/11 (piano pronto, sito e analisi mai chiesti) li chiede all AD una volta', async () => {
    stato.db.tabelle.ordini_sdg = [{
      id: 'b95824e3-c3a9-4315-88ce-dfdeb55e0da2', seller_id: '2eed4371-5e63-4086-b8b6-7c3cfc3bf263', nome_attivita: 'PROVA SDG - attività finta', fascia: 'premium',
      dati_attivita: { tipo: 'bar', dettaglio: null, indirizzo: null, citta: 'Piacenza', dallaScheda: null }, piano: { contenuti: [] }, piano_completo_stato: 'pronto',
      lavoro: null, aggiornato_il: '2026-11-27T23:49:00Z', ...PREDEFINITI_999H,
    }];
    expect(await chiediIlPezzo('b95824e3-c3a9-4315-88ce-dfdeb55e0da2', 'sito')).toEqual({ esito: 'chiesto' });
    expect(await chiediIlPezzo('b95824e3-c3a9-4315-88ce-dfdeb55e0da2', 'analisi')).toEqual({ esito: 'chiesto' });
    // Un secondo clic non fa una seconda corsa dell'AD.
    expect(await chiediIlPezzo('b95824e3-c3a9-4315-88ce-dfdeb55e0da2', 'sito')).toEqual({ esito: 'non-serve' });
    expect(stato.avviati).toHaveLength(2);
    expect((lavoroDi(COMPITO_SITO)!.job.dati as { abbonamento: { pagine: number } }).abbonamento.pagine).toBe(5);
  });
});

// 28/11/2026, 01:25 — Nicola: le voci sono i quattro servizi. L'agente sceglie quali servono; all'accettazione l'AD
// prepara SOLO i lavori dei servizi scelti (lib/agenzia/servizi-scelti.ts). Foto e video la fa la squadra.
describe('⑥ partono solo i lavori dei servizi scelti dall agente', () => {
  const sceglie = (servizi: string[] | null, nota: string | null = null) => {
    Object.assign(stato.db.tabelle.preventivi_con_codice[0], { servizi_scelti: servizi, nota_agente: nota });
  };

  it.each([
    [['sito_web'], ['sito']],
    [['social', 'analisi'], ['piano', 'analisi']],
    [['foto_video', 'sito_web', 'social', 'analisi'], ['piano', 'sito', 'analisi']],
  ])('con %j partono solo i loro lavori', async (servizi, lavori) => {
    const COMPITI: Record<string, string> = { piano: COMPITO_PIANO, sito: COMPITO_SITO, analisi: COMPITO_ANALISI };
    sceglie(servizi);
    expect((await accetta('business')).ok).toBe(true);
    await aspettaILavori(lavori.length);
    await new Promise((r) => setTimeout(r, 50));
    expect(stato.avviati.map((a) => a.job.compito).sort()).toEqual(lavori.map((l) => COMPITI[l]).sort());
    expect(ordini()[0].dati_attivita).toMatchObject({ servizi });
  });

  it('con solo «Foto e video» non parte nessun lavoro dell AD, ma l ordine nasce e l avviso lo dice', async () => {
    sceglie(['foto_video'], 'vuole far vedere la sala per le feste');
    vi.mocked(notifyAdmins).mockClear();
    expect((await accetta('premium')).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(stato.avviati).toHaveLength(0);
    expect(ordini()).toHaveLength(1);
    expect(ordini()[0]).toMatchObject({ sito_stato: 'da_collegare', analisi_stato: 'da_collegare' });
    const testo = vi.mocked(notifyAdmins).mock.calls.map((c) => String(c[1])).join(' ');
    expect(testo).toMatch(/Servizi scelti: Foto e video/);
    expect(testo).toMatch(/sala per le feste/);
    expect(testo).toMatch(/niente \(solo foto e video/);
  });

  it('senza la scelta (preventivo di prima della 999h) partono tutti e tre, come prima', async () => {
    sceglie(null);
    expect((await accetta('base')).ok).toBe(true);
    await aspettaILavori(3);
    expect(stato.avviati).toHaveLength(3);
  });

  it('la nota dell agente arriva nei compiti del sito e dell analisi; un servizio fuori elenco nel database si scarta', async () => {
    sceglie(['sito_web', 'analisi', 'volantini'], 'vuole far vedere la sala per le feste');
    await accetta('business');
    await aspettaILavori(2);
    await new Promise((r) => setTimeout(r, 30));
    expect(ordini()[0].dati_attivita).toMatchObject({ servizi: ['sito_web', 'analisi'], notaAgente: 'vuole far vedere la sala per le feste' });
    expect((lavoroDi(COMPITO_SITO)!.job.dati as { nota_dell_agente: string }).nota_dell_agente).toBe('vuole far vedere la sala per le feste');
    expect((lavoroDi(COMPITO_ANALISI)!.job.dati as { nota_dell_agente: string }).nota_dell_agente).toBe('vuole far vedere la sala per le feste');
  });

  it('il titolare vede il lavoro solo nelle voci dei servizi scelti; mai la nota dell agente', async () => {
    sceglie(['sito_web'], 'vuole far vedere la sala per le feste');
    await accetta('business');
    await aspettaILavori(1);
    const visto = await lavoroDallOrdine(SELLER);
    expect(visto?.servizi).toEqual(['sito_web']);
    expect(JSON.stringify(visto)).not.toContain('sala per le feste');
    expect(parteDellOrdine('sito_web', visto)).toBe('sito');
    expect(parteDellOrdine('social', visto)).toBeNull();
    expect(parteDellOrdine('analisi', visto)).toBeNull();
    expect(parteDellOrdine('foto_video', visto)).toBeNull();
  });
});

// 28/11/2026, 01:40 — Nicola: i servizi li segna il venditore, ma il cliente li può cambiare nel link. All'accettazione
// valgono quelli confermati dal cliente.
describe('⑦ valgono i servizi confermati dal cliente, non quelli del venditore', () => {
  it('il venditore segna «Gestione sito web», il cliente conferma social e analisi: partono piano e analisi, non il sito', async () => {
    Object.assign(stato.db.tabelle.preventivi_con_codice[0], { servizi_scelti: ['sito_web'] });
    const letto = await leggiPreventivoColCodice(CODICE);
    expect(letto?.serviziScelti).toEqual(['sito_web']);
    expect((await accetta('business', ['analisi', 'social'])).ok).toBe(true);
    await aspettaILavori(2);
    await new Promise((r) => setTimeout(r, 50));
    expect(stato.avviati.map((a) => a.job.compito).sort()).toEqual([COMPITO_PIANO, COMPITO_ANALISI].sort());
    expect(stato.db.tabelle.preventivi_con_codice[0].servizi_scelti).toEqual(['social', 'analisi']);
    expect(ordini()[0].dati_attivita).toMatchObject({ servizi: ['social', 'analisi'] });
    const testo = vi.mocked(notifyAdmins).mock.calls.map((c) => String(c[1])).join(' ');
    expect(testo).toMatch(/Servizi confermati: Gestione social e Google, Analisi di mercato/);
  });

  it('se la pagina non manda i servizi (aperta prima di oggi) restano quelli del venditore', async () => {
    Object.assign(stato.db.tabelle.preventivi_con_codice[0], { servizi_scelti: ['sito_web'] });
    expect((await accetta('business')).ok).toBe(true);
    await aspettaILavori(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(stato.avviati.map((a) => a.job.compito)).toEqual([COMPITO_SITO]);
  });

  it('prima della 999h il link si apre e l accettazione va: la colonna dei servizi non c è', async () => {
    stato.db.colonneMancanti = { preventivi_con_codice: ['servizi_scelti', 'nota_agente'] };
    const letto = await leggiPreventivoColCodice(CODICE);
    expect(letto?.serviziScelti).toBeNull();
    expect((await accetta('base', ['sito_web'])).ok).toBe(true);
    expect(stato.db.tabelle.preventivi_con_codice[0].stato).toBe('accettato');
  });

  // Collaudo 28/11/2026 — L'ordine rileggeva i servizi dal preventivo: se la scrittura di quelli del cliente cadeva,
  // partivano i lavori del venditore mentre l'avviso a Nicola diceva «Servizi confermati» quelli del cliente.
  it('se la scrittura dei servizi del cliente cade, partono lo stesso i lavori dei servizi del cliente', async () => {
    Object.assign(stato.db.tabelle.preventivi_con_codice[0], { servizi_scelti: ['sito_web'] });
    stato.db.scrittureGuaste = { preventivi_con_codice: ['servizi_scelti'] };
    expect((await accetta('business', ['social', 'social', 'analisi'])).ok).toBe(true);
    await aspettaILavori(2);
    await new Promise((r) => setTimeout(r, 50));
    expect(stato.db.tabelle.preventivi_con_codice[0].servizi_scelti).toEqual(['sito_web']);
    expect(stato.avviati.map((a) => a.job.compito).sort()).toEqual([COMPITO_PIANO, COMPITO_ANALISI].sort());
    expect(ordini()[0].dati_attivita).toMatchObject({ servizi: ['social', 'analisi'] });
  });

  it('prima della 999h valgono i servizi del cliente, non tutti e quattro', async () => {
    stato.db.colonneMancanti = { preventivi_con_codice: ['servizi_scelti', 'nota_agente'] };
    expect((await accetta('business', ['social'])).ok).toBe(true);
    await aspettaILavori(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(stato.avviati.map((a) => a.job.compito)).toEqual([COMPITO_PIANO]);
  });

  it('un preventivo già accettato o chiuso non scrive servizi e non fa partire lavori', async () => {
    for (const st of ['accettato', 'chiuso'] as const) {
      Object.assign(stato.db.tabelle.preventivi_con_codice[0], { stato: st, servizi_scelti: ['sito_web'] });
      const preventivo = await leggiPreventivoColCodice(CODICE);
      const esito = await accettaPreventivoColCodice({ preventivo: preventivo!, codice: CODICE, email: 'titolare@esempio.it', fascia: 'business', servizi: ['analisi'] });
      expect(esito.ok).toBe(false);
      expect(stato.db.tabelle.preventivi_con_codice[0].servizi_scelti).toEqual(['sito_web']);
    }
    // Anche se il preventivo letto dice «aperto» ma intanto l'ha preso un altro invio (la presa conta le righe).
    const preventivo = await leggiPreventivoColCodice(CODICE);
    const esito = await accettaPreventivoColCodice({ preventivo: { ...preventivo!, stato: 'aperto' }, codice: CODICE, email: 'titolare@esempio.it', fascia: 'business', servizi: ['analisi'] });
    expect(esito.ok).toBe(false);
    expect(stato.db.tabelle.preventivi_con_codice[0].servizi_scelti).toEqual(['sito_web']);
    await new Promise((r) => setTimeout(r, 50));
    expect(stato.avviati).toEqual([]);
    expect(ordini()).toEqual([]);
  });
});
