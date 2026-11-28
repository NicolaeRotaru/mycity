import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { nuovoDb, supabaseFinto, type DbFinto } from './_supabase-finto';

/**
 * L'ORDINE DI SERVIZIO ARRIVA A SDG — 27/11/2026 (Nicola, 17:25).
 *
 * «Quando … l'imprenditore conferma con le mail l'abbonamento … in automatico deve arrivare l'ordine del servizio,
 * quindi nella pagina venditore di SDG … con su scritto tutti i dati, quindi che abbonamento ha scelto
 * l'imprenditore, e tutto il piano editoriale già fatto». Queste prove dicono:
 *  ① preventivo accettato → nasce UN ordine per SDG, anche se l'accettazione si ripete;
 *  ② l'ordine porta fascia, canone, attività, agente e visita, con la frase esatta della data («da fissare» se manca);
 *  ③ se n8n non risponde, l'accettazione riesce lo stesso e l'ordine ha il piano del sito;
 *  e il piano completo dell'AD: passa dal flusso 14 così com'è, entra solo se rispetta la fascia.
 */

const SELLER = '0de1905e-7000-4000-8000-0000000000aa';
const CODICE = 'b'.repeat(64);
const LAVORO = '11111111-2222-4333-8444-555555555555';

const stato = vi.hoisted(() => ({
  db: null as unknown as DbFinto,
  avvisi: [] as { titolo: string; testo: string; link: string; opzioni: Record<string, unknown> }[],
  n8nCollegato: true,
  avviati: [] as { lavoro: string; venditore: string; nome: string; prima: unknown; job: Record<string, unknown> }[],
  esitoAvvio: { ok: true } as { ok: boolean; errore?: string },
  lavori: {} as Record<string, unknown>,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://www.mycity-marketplace.com' } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: vi.fn(async (titolo: string, testo: string, link: string, opzioni: Record<string, unknown>) => { stato.avvisi.push({ titolo, testo, link, opzioni }); }),
}));
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
  avviaLavoro: vi.fn(async (lavoro: string, venditore: string, nome: string, prima: unknown, job: Record<string, unknown>) => {
    stato.avviati.push({ lavoro, venditore, nome, prima, job });
    return stato.esitoAvvio;
  }),
  leggiLavoro: vi.fn(async (lavoro: string) => stato.lavori[lavoro] ?? { stato: 'sconosciuto', errore: 'n8n non risponde' }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    ...supabaseFinto(stato.db),
    auth: {
      admin: {
        updateUserById: async (id: string) => ({ data: { user: { id } }, error: null }),
        generateLink: async () => ({ data: { properties: { action_link: 'https://supabase.test/verify?token=t', hashed_token: 'h' } }, error: null }),
      },
    },
  }),
}));

const { accettaPreventivoColCodice, leggiPreventivoColCodice } = await import('@/lib/agenzia/preventivo-col-codice');
const { creaOrdineSdg, fraseVisita, aggiornaPianoCompleto, chiediIlPianoCompleto } = await import('@/lib/agenzia/ordine-sdg');
const { pianoDallaRisposta } = await import('@/lib/agenzia/piano-completo-ad');
const { passiDiSdg } = await import('@/lib/agenti/passi-di-sdg');
const { pianoDelPrimoMese } = await import('@/lib/agenzia/piano-del-primo-mese');
const { VENDITORE_DEI_PIANI, COMPITO_PIANO, SCHEMA_PIANO } = await import('@/lib/agenzia/piano-completo-ad');

const ordini = () => (stato.db.tabelle.ordini_sdg ?? []) as Record<string, unknown>[];
const aspetta = () => vi.waitFor(() => expect(ordini()[0]?.piano_completo_stato).not.toBe(undefined)).then(() => new Promise((r) => setTimeout(r, 20)));

function preparaDb() {
  const db = nuovoDb();
  db.tabelle.profiles = [{ id: SELLER, role: 'seller', store_name: 'Caffè di Prova', store_address: 'Piazza Duomo 8, Piacenza', city: 'Piacenza', business_type: 'bar', business_type_detail: 'Bar e caffetteria', visibile_senza_abbonamento: false }];
  db.tabelle.preventivi_con_codice = [{
    seller_id: SELLER, codice: CODICE, stato: 'aperto', fascia_scelta: 'business', creato_il: '2026-11-27T10:00:00Z',
    accettato_il: null, condizioni_accettate_il: null, lavoro: LAVORO, agente_email: 'agente@esempio.it',
    // La visita la scrive la conferma del titolare (migrazione 999b), nella stessa scrittura dell'«accettato».
    visita_il: null,
  }];
  // Lo sblocco in contanti fatto al «Sì» dell'agente (migrazione 999): è il primo abbonamento, il primo mese è a metà.
  db.tabelle.abbonamenti_servizi = [{ id: 'abb-1', seller_id: SELLER, fascia: 'business', canone_centesimi: 50000, stato: 'active', origine: 'contanti' }];
  db.tabelle.schede_clienti = [];
  return db;
}

const VISITA = '2026-12-03T09:00:00.000Z';
/** `visita: null` = il titolare non ha scelto il giorno. */
async function accetta(fascia: 'base' | 'business' | 'premium' = 'business', visita: string | null = VISITA) {
  const preventivo = await leggiPreventivoColCodice(CODICE);
  return accettaPreventivoColCodice({ preventivo: preventivo!, codice: CODICE, email: 'titolare@esempio.it', fascia, visita: visita ?? undefined });
}

beforeEach(() => {
  stato.db = preparaDb();
  stato.avvisi = [];
  stato.n8nCollegato = true;
  stato.avviati = [];
  stato.esitoAvvio = { ok: true };
  stato.lavori = {};
});

describe('① il preventivo accettato fa nascere UN ordine per SDG', () => {
  it('alla conferma del titolare nasce l ordine; una seconda conferma non fa un doppione', async () => {
    const preventivo = await leggiPreventivoColCodice(CODICE);
    const prima = await accettaPreventivoColCodice({ preventivo: preventivo!, codice: CODICE, email: 'titolare@esempio.it', fascia: 'business', visita: VISITA });
    expect(prima.ok).toBe(true);
    expect(ordini()).toHaveLength(1);
    // Il doppio invio: la pagina aveva letto il preventivo ancora aperto e preme di nuovo.
    const seconda = await accettaPreventivoColCodice({ preventivo: preventivo!, codice: CODICE, email: 'titolare@esempio.it', fascia: 'premium', visita: VISITA });
    expect(seconda.ok).toBe(false);
    // E anche chiamata a mano, due volte, l'ordine resta uno e resta Business.
    expect(await creaOrdineSdg({ sellerId: SELLER, codice: CODICE, fascia: 'premium' })).toEqual({ ok: true, nuovo: false, id: null });
    expect(await creaOrdineSdg({ sellerId: SELLER, codice: CODICE, fascia: 'premium' })).toEqual({ ok: true, nuovo: false, id: null });
    expect(ordini()).toHaveLength(1);
    expect(ordini()[0].fascia).toBe('business');
    expect(stato.avvisi.filter((a) => a.titolo.startsWith('Ordine di servizio per SDG'))).toHaveLength(1);
    // 28/11/2026 — L'avviso va solo agli amministratori: apre la pagina dell'admin, non il pannello del negozio
    // (Nicola, 15:45: «mi manda nella versione venditore»).
    expect(stato.avvisi.find((a) => a.titolo.startsWith('Ordine di servizio'))?.link).toBe('/admin/ordini-sdg');
    await aspetta();
  });

  it('un preventivo non accettato, o di un altro negozio, non fa nascere niente', async () => {
    expect(await creaOrdineSdg({ sellerId: SELLER, codice: CODICE, fascia: 'business' })).toEqual({ ok: false, motivo: 'non-accettato' });
    stato.db.tabelle.preventivi_con_codice[0].stato = 'accettato';
    expect(await creaOrdineSdg({ sellerId: '0de1905e-7000-4000-8000-0000000000bb', codice: CODICE, fascia: 'business' })).toEqual({ ok: false, motivo: 'non-accettato' });
    expect(await creaOrdineSdg({ sellerId: SELLER, codice: 'c'.repeat(64), fascia: 'business' })).toEqual({ ok: false, motivo: 'non-accettato' });
    expect(ordini()).toHaveLength(0);
  });

  it('non lancia mai: senza la tabella degli ordini (999c non applicata) l accettazione riesce lo stesso', async () => {
    stato.db.tabelleMancanti = ['ordini_sdg'];
    stato.db.colonneMancanti = { preventivi_con_codice: ['lavoro', 'agente_email', 'visita_il'] };
    const esito = await accetta();
    expect(esito.ok).toBe(true);
    expect(stato.db.tabelle.preventivi_con_codice[0].stato).toBe('accettato');
    expect(await creaOrdineSdg({ sellerId: SELLER, codice: CODICE, fascia: 'business' })).toMatchObject({ ok: false, motivo: 'guasto' });
    // L'ordine perso non resta solo nel log: Nicola lo sa, una volta.
    const persi = stato.avvisi.filter((a) => a.titolo.startsWith('ATTENZIONE: l\'ordine di servizio per SDG di Caffè di Prova non è nato'));
    expect(persi.length).toBeGreaterThanOrEqual(1);
    expect(persi[0].opzioni).toEqual({ unaVoltaPer: `ordine-sdg-mancato:${SELLER}` });
    // Anche con un database che esplode.
    expect(await creaOrdineSdg(null as unknown as Parameters<typeof creaOrdineSdg>[0])).toMatchObject({ ok: false, motivo: 'guasto' });
  });
});

describe('② l ordine porta fascia, canone, attività, agente e visita', () => {
  it('dentro ci sono i dati giusti, e la frase della visita è quella promessa', async () => {
    await accetta();
    const o = ordini()[0];
    expect(o).toMatchObject({
      seller_id: SELLER, nome_attivita: 'Caffè di Prova', fascia: 'business', canone_centesimi: 50000, primo_mese_centesimi: 25000,
      agente_email: 'agente@esempio.it', lavoro: LAVORO, visita_il: '2026-12-03T09:00:00.000Z', piano_origine: 'sito',
    });
    expect(o.dati_attivita).toMatchObject({ tipo: 'bar', indirizzo: 'Piazza Duomo 8, Piacenza', citta: 'Piacenza', dettaglio: 'Bar e caffetteria' });
    expect(typeof o.accettato_il).toBe('string');
    expect(fraseVisita(o.visita_il as string)).toBe('Visita: giovedì 3 dicembre alle 10:00');
    const avviso = stato.avvisi.find((a) => a.titolo === 'Ordine di servizio per SDG: Caffè di Prova');
    expect(avviso?.testo).toContain('Visita: giovedì 3 dicembre alle 10:00.');
    expect(avviso?.testo).toContain('Business');
    expect(avviso?.testo).toContain('agente@esempio.it');
    await aspetta();
  });

  it('con la 999b non ancora applicata l ordine ha lo stesso il giorno scelto dal titolare', async () => {
    stato.db.colonneMancanti = { preventivi_con_codice: ['visita_il'] };
    expect((await accetta()).ok).toBe(true);
    expect(ordini()[0].visita_il).toBe(VISITA);
    expect(stato.avvisi.find((a) => a.titolo.startsWith('Ordine'))?.testo).toContain('Visita: giovedì 3 dicembre alle 10:00.');
    await aspetta();
  });

  it('se il titolare non ha scelto la data l ordine dice «da fissare col titolare»', async () => {
    await accetta('business', null);
    expect(ordini()[0].visita_il).toBeNull();
    expect(fraseVisita(null)).toBe('Visita: da fissare col titolare');
    expect(fraseVisita(undefined)).toBe('Visita: da fissare col titolare');
    expect(fraseVisita('non una data')).toBe('Visita: da fissare col titolare');
    expect(stato.avvisi.find((a) => a.titolo.startsWith('Ordine'))?.testo).toContain('Visita: da fissare col titolare.');
    await aspetta();
  });

  it('la data passata da chi chiama vince su quella del database; null vuol dire «non fissata»', async () => {
    stato.db.tabelle.preventivi_con_codice[0].stato = 'accettato';
    await creaOrdineSdg({ sellerId: SELLER, codice: CODICE, fascia: 'business', visitaIl: null });
    expect(ordini()[0].visita_il).toBeNull();
    stato.db = preparaDb();
    stato.db.tabelle.preventivi_con_codice[0].stato = 'accettato';
    await creaOrdineSdg({ sellerId: SELLER, codice: CODICE, fascia: 'business', visitaIl: '2026-12-10T15:30:00Z' });
    expect(fraseVisita(ordini()[0].visita_il as string)).toBe('Visita: giovedì 10 dicembre alle 16:30');
    await aspetta();
  });

  it('un abbonamento già avuto prima: niente primo mese a metà; senza agente l ordine lo dice', async () => {
    stato.db.tabelle.abbonamenti_servizi.push({ id: 'abb-0', seller_id: SELLER, fascia: 'base', canone_centesimi: 30000, stato: 'canceled', origine: 'contanti' });
    stato.db.tabelle.preventivi_con_codice[0].agente_email = null;
    stato.db.tabelle.preventivi_con_codice[0].lavoro = null;
    await accetta();
    expect(ordini()[0]).toMatchObject({ canone_centesimi: 50000, primo_mese_centesimi: 50000, agente_email: null, lavoro: null });
    expect(stato.avvisi.find((a) => a.titolo.startsWith('Ordine'))?.testo).toContain('Senza agente');
    await aspetta();
  });
});

describe('③ se n8n non risponde l accettazione riesce e l ordine ha il piano del sito', () => {
  it('n8n giù: il titolare ha la sua conferma, l ordine ha 12 contenuti e il piano completo resta «da collegare»', async () => {
    stato.esitoAvvio = { ok: false, errore: 'n8n non risponde' };
    const esito = await accetta();
    expect(esito.ok).toBe(true);
    await vi.waitFor(() => expect(ordini()[0].piano_completo_errore).toContain('n8n non risponde'));
    const o = ordini()[0];
    expect(o.piano_completo_stato).toBe('da_collegare');
    expect(o.lavoro_piano).toBeNull();
    const piano = o.piano as { origine: string; contenuti: { tipo: string; data: string }[] };
    expect(piano.origine).toBe('sito');
    expect(piano.contenuti).toHaveLength(12);
    expect(piano.contenuti.filter((c) => c.tipo === 'Reel')).toHaveLength(2);
    // Il piano parte dal lunedì dopo la visita (giovedì 3 dicembre → lunedì 7).
    expect(piano.contenuti.every((c) => c.data >= '2026-12-07' && c.data <= '2027-01-03')).toBe(true);
  });

  it('collegamento con l AD spento: nessun lavoro parte, l ordine lo dice', async () => {
    stato.n8nCollegato = false;
    expect((await accetta()).ok).toBe(true);
    await vi.waitFor(() => expect(ordini()[0].piano_completo_errore).toContain('non è acceso'));
    expect(stato.avviati).toHaveLength(0);
    expect(ordini()[0].piano_completo_stato).toBe('da_collegare');
  });
});

describe('il piano completo dell AD', () => {
  it('parte dal flusso 14 col venditore di sistema di SDG, senza email del titolare né dell agente né l ora della visita', async () => {
    await accetta();
    await vi.waitFor(() => expect(ordini()[0].piano_completo_stato).toBe('in_corso'));
    expect(stato.avviati).toHaveLength(1);
    const a = stato.avviati[0];
    expect(a.venditore).toBe(VENDITORE_DEI_PIANI);
    expect(ordini()[0].lavoro_piano).toBe(a.lavoro);
    const tutto = JSON.stringify(a);
    expect(tutto).not.toContain('titolare@esempio.it');
    expect(tutto).not.toContain('agente@esempio.it');
    expect(tutto).not.toContain('09:00:00');
    // Né scritta come la legge il titolare (collaudo del 27/11: la prova guardava solo l'ora UTC).
    expect(tutto).not.toContain('2026-12-03');
    expect(tutto).not.toContain('3 dicembre');
    // Il compito per l'AD nomina la visita come idea («cosa preparare alla visita»); i dati del locale no.
    expect(JSON.stringify({ prima: a.prima, dati: a.job.dati })).not.toMatch(/visita/i);
    expect((a.job.dati as { abbonamento: { contenuti: number; video: number } }).abbonamento).toMatchObject({ contenuti: 12, video: 2 });
  });

  it('il lavoro passa dal nodo vero «Controlla il lavoro» del flusso 14 (copia letta il 27/11)', async () => {
    await accetta('premium');
    await vi.waitFor(() => expect(stato.avviati).toHaveLength(1));
    const { lavoro, venditore, nome, prima, job } = stato.avviati[0];
    const corpo = JSON.parse(JSON.stringify({ lavoro, venditore, nome, prima, ...job }));
    const codice = fs.readFileSync(path.join(__dirname, 'materiale', 'controlla-lavoro-flusso-14.js'), 'utf8');
    const $ = (n: string) => ({ first: () => (n === 'Dal sito del venditore' ? { json: { body: corpo } } : undefined) });
    const Fn = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => (x: unknown) => Promise<{ json: Record<string, unknown> }[]>;
    const [esito] = await new Fn('$', codice)($);
    expect(esito.json.valido, String(esito.json.motivo)).toBe(true);
    expect(COMPITO_PIANO.length).toBeLessThan(30_000);
    expect(JSON.stringify({ compito: COMPITO_PIANO, dati: job.dati, schema: SCHEMA_PIANO }).length).toBeLessThan(60_000);
  });

  it('quando torna e rispetta la fascia prende il posto del piano del sito; se sbaglia le quantità resta quello del sito', async () => {
    await accetta();
    await vi.waitFor(() => expect(ordini()[0].piano_completo_stato).toBe('in_corso'));
    const admin = (await import('@/lib/supabase/server')).getAdminSupabase();
    const o = { ...ordini()[0] } as unknown as Parameters<typeof aggiornaPianoCompleto>[1];
    const partenza = o.piano;
    const buono = {
      intestazione: { canali_e_tono: 'Instagram e Facebook, tono cordiale', hashtag: '#Piacenza #CaffèDiProva', prima_di_pubblicare: 'Confermare gli orari della domenica' },
      contenuti: partenza.contenuti.map((c, i) => ({ data: c.data, ora: c.ora, tipo: c.tipo, tema: `Tema ${i}`, didascalia: `Didascalia ${i} #Piacenza`, cosa_riprendere: 'Foto del bancone', in_citta: i === 0 ? 'Mercato del sabato' : null, fonte_evento: i === 0 ? 'https://www.comune.piacenza.it/mercato' : null })),
      note: ['Portare il treppiede alla visita'],
    };
    // Sbagliato: tre video nel Business, che ne dà due.
    const sbagliato = { ...buono, contenuti: buono.contenuti.map((c, i) => (i === 0 ? { ...c, tipo: 'Reel' } : c)) };
    stato.lavori[o.lavoro_piano!] = { stato: 'pronta', venditore: VENDITORE_DEI_PIANI, risultato: sbagliato };
    const dopoSbaglio = await aggiornaPianoCompleto(admin as never, o);
    expect(dopoSbaglio.piano_completo_stato).toBe('errore');
    expect(dopoSbaglio.piano_completo_errore).toContain('quantità del Business');
    expect((ordini()[0].piano as { origine: string }).origine).toBe('sito');

    // Di nuovo in corso, col piano giusto.
    Object.assign(ordini()[0], { piano_completo_stato: 'in_corso' });
    stato.lavori[o.lavoro_piano!] = { stato: 'pronta', venditore: VENDITORE_DEI_PIANI, risultato: buono };
    const pronto = await aggiornaPianoCompleto(admin as never, { ...o, piano_completo_stato: 'in_corso' });
    expect(pronto.piano_completo_stato).toBe('pronto');
    expect(ordini()[0]).toMatchObject({ piano_origine: 'ad', piano_completo_stato: 'pronto' });
    const piano = ordini()[0].piano as { origine: string; contenuti: { inCitta: string | null; fonteEvento?: string | null }[]; intestazione: { cliente: string } };
    expect(piano.origine).toBe('ad');
    expect(piano.contenuti).toHaveLength(12);
    expect(piano.contenuti[0]).toMatchObject({ inCitta: 'Mercato del sabato', fonteEvento: 'https://www.comune.piacenza.it/mercato' });
    expect(piano.intestazione.cliente).toContain('Caffè di Prova');
  });

  it('un lavoro di un altro (venditore diverso) o un AD che non risponde da 45 minuti non entrano nell ordine', async () => {
    await accetta();
    await vi.waitFor(() => expect(ordini()[0].piano_completo_stato).toBe('in_corso'));
    const admin = (await import('@/lib/supabase/server')).getAdminSupabase();
    const o = { ...ordini()[0] } as unknown as Parameters<typeof aggiornaPianoCompleto>[1];
    stato.lavori[o.lavoro_piano!] = { stato: 'pronta', venditore: 'agente@esempio.it', risultato: {} };
    expect((await aggiornaPianoCompleto(admin as never, o)).piano_completo_stato).toBe('in_corso');
    stato.lavori[o.lavoro_piano!] = { stato: 'in_corso', venditore: VENDITORE_DEI_PIANI };
    const tardi = await aggiornaPianoCompleto(admin as never, o, Date.parse(o.aggiornato_il) + 46 * 60_000);
    expect(tardi.piano_completo_stato).toBe('errore');
    expect(tardi.piano_completo_errore).toContain('45 minuti');
  });
});

describe('il piano del primo mese, calcolato dal sito', () => {
  const visita = '2026-12-03T09:00:00Z';
  it.each([
    ['base', 8, 0, [2, 5]],
    ['business', 12, 2, [2, 4, 6]],
    ['premium', 20, 4, [2, 3, 4, 5, 6]],
  ] as const)('%s: %i contenuti, %i video, nei giorni della fascia, dopo la visita', (fascia, quanti, video, giorni) => {
    const p = pianoDelPrimoMese({ nome: 'Caffè di Prova', tipo: 'bar', fascia, visitaIl: visita, citta: 'Piacenza' });
    expect(p.contenuti).toHaveLength(quanti);
    expect(p.contenuti.filter((c) => c.tipo === 'Reel')).toHaveLength(video);
    expect(p.contenuti.every((c) => (giorni as readonly number[]).includes(new Date(`${c.data}T12:00:00Z`).getUTCDay()))).toBe(true);
    expect(p.contenuti.every((c) => c.data > '2026-12-03')).toBe(true);
    expect(new Set(p.contenuti.map((c) => c.tema)).size).toBe(quanti);
    expect(p.periodo).toEqual({ dal: '2026-12-07', al: '2027-01-03', titolo: 'dal 7 dicembre 2026 al 3 gennaio 2027' });
    expect(p.intestazione.hashtag).toBe('#Piacenza #CaffèDiProva');
    expect(p.contenuti.every((c) => c.didascalia.endsWith('#Piacenza #CaffèDiProva') && c.stato === 'Idea' && c.inCitta === null)).toBe(true);
  });

  it('senza visita parte dal lunedì dopo la conferma, e lo dice', () => {
    const p = pianoDelPrimoMese({ nome: 'Caffè di Prova', tipo: 'ristorante', fascia: 'business', accettatoIl: '2026-11-27T16:25:00Z' });
    expect(p.periodo.dal).toBe('2026-11-30');
    expect(p.note.join(' ')).toContain('La visita non è ancora fissata');
    expect(p.contenuti.find((c) => c.tipo === 'Post')?.ora).toBe('18:30');
  });
});

describe('dal collaudo del 27/11', () => {
  it('nel Base la pagina dell agente non promette video né riprese; nel Business e nel Premium sì', () => {
    const passi = (fascia: 'base' | 'business' | 'premium', visitaIl: string | null) =>
      passiDiSdg({ nome: 'Caffè di Prova', fascia, visitaIl, canoneCentesimi: null, primoMeseCentesimi: null, pianoNellOrdine: { origine: 'sito', stato: 'da_collegare' } });
    for (const v of ['2026-12-03T09:00:00Z', null]) {
      // «senza video» è il listino del Base detto giusto, non una promessa.
      const base = JSON.stringify(passi('base', v)).replace(/senza video/g, '');
      expect(base).not.toMatch(/video|riprese/i);
      expect(passi('base', v)[1].titolo).toBe('Le prime foto');
      expect(JSON.stringify(passi('business', v))).toMatch(/video/);
      expect(passi('premium', v)[1].titolo).toBe('Le prime foto e i primi video');
    }
  });

  it('senza l ordine la pagina non inventa il primo mese', () => {
    const p = passiDiSdg({ nome: 'X', fascia: 'business', visitaIl: null, canoneCentesimi: null, primoMeseCentesimi: null, pianoNellOrdine: null });
    expect(p[4].testo).toContain('Quanto si ritira il primo mese lo dice l’ordine di SDG');
  });

  it('un nome con $& non rompe la frase della visita', () => {
    const p = passiDiSdg({ nome: 'Bar $& Sport', fascia: 'business', visitaIl: '2026-12-03T09:00:00Z', canoneCentesimi: null, primoMeseCentesimi: null, pianoNellOrdine: null });
    expect(p[0].testo).toContain('Bar $& Sport nel giorno scelto dal titolare (giovedì 3 dicembre alle 10:00)');
  });

  it('vale la fascia confermata dal titolare, non quella scelta dall agente', async () => {
    // L'agente aveva detto Business; il titolare conferma Premium.
    await accetta('premium');
    expect(ordini()[0]).toMatchObject({ fascia: 'premium', canone_centesimi: 90000, primo_mese_centesimi: 45000 });
    expect((ordini()[0].piano as { contenuti: { tipo: string }[] }).contenuti).toHaveLength(20);
    await aspetta();
  });

  it('il canone è quello dello sblocco in contanti (il listino delle impostazioni), non quello scritto nel codice', async () => {
    stato.db.tabelle.abbonamenti_servizi[0].canone_centesimi = 45000;
    await accetta();
    expect(ordini()[0]).toMatchObject({ canone_centesimi: 45000, primo_mese_centesimi: 22500 });
    await aspetta();
  });

  it('due richieste del piano completo insieme fanno UN lavoro dell AD', async () => {
    stato.db.tabelle.preventivi_con_codice[0].stato = 'accettato';
    stato.n8nCollegato = false; // l'ordine nasce senza chiedere il piano
    await creaOrdineSdg({ sellerId: SELLER, codice: CODICE, fascia: 'business', visitaIl: null });
    await vi.waitFor(() => expect(ordini()[0].piano_completo_errore).toContain('non è acceso'));
    stato.n8nCollegato = true;
    const id = String(ordini()[0].id);
    const esiti = await Promise.all([chiediIlPianoCompleto(id), chiediIlPianoCompleto(id)]);
    expect(esiti.map((e) => e.esito).sort()).toEqual(['chiesto', 'non-serve']);
    expect(stato.avviati).toHaveLength(1);
  });

  it('una visita al lunedì a mezzanotte e mezza (domenica in UTC) fa partire il piano il lunedì DOPO', () => {
    // Lunedì 7 dicembre alle 00:30 di Roma = domenica 6 dicembre alle 23:30 UTC.
    const p = pianoDelPrimoMese({ nome: 'Caffè di Prova', tipo: 'bar', fascia: 'business', visitaIl: '2026-12-06T23:30:00Z' });
    expect(p.periodo.dal).toBe('2026-12-14');
    expect(fraseVisita('2026-12-06T23:30:00Z')).toBe('Visita: lunedì 7 dicembre alle 00:30');
    // E al lunedì alle 10: mai lo stesso giorno della visita.
    expect(pianoDelPrimoMese({ nome: 'X', tipo: 'bar', fascia: 'base', visitaIl: '2026-12-07T09:00:00Z' }).periodo.dal).toBe('2026-12-14');
  });

  describe('il piano dell AD entra solo se rispetta le regole', () => {
    const partenza = pianoDelPrimoMese({ nome: 'Caffè di Prova', tipo: 'bar', fascia: 'business', visitaIl: '2026-12-03T09:00:00Z', citta: 'Piacenza' });
    const buono = () => ({
      intestazione: { canali_e_tono: 'Instagram e Facebook', hashtag: '#Piacenza', prima_di_pubblicare: 'Confermare gli orari' },
      contenuti: partenza.contenuti.map((c, i) => ({ data: c.data, ora: c.ora, tipo: c.tipo, tema: `Tema ${i}`, didascalia: `Didascalia ${i}`, cosa_riprendere: 'Foto', in_citta: null as string | null, fonte_evento: null as string | null })),
      note: [] as string[],
    });
    const con = (f: (r: ReturnType<typeof buono>) => void) => { const r = buono(); f(r); return pianoDallaRisposta(r, partenza, 'business'); };

    it('quello giusto entra', () => { expect(pianoDallaRisposta(buono(), partenza, 'business').ok).toBe(true); });
    it('una data fuori dal periodo no', () => {
      expect(con((r) => { r.contenuti[0].data = '2026-12-01'; })).toMatchObject({ ok: false, motivo: expect.stringContaining('fuori dal periodo') });
    });
    it('gioco o tabacco no; il nome del locale e gli hashtag non contano', () => {
      expect(con((r) => { r.contenuti[2].didascalia = 'Prova la fortuna col gratta e vinci'; })).toMatchObject({ ok: false, motivo: expect.stringContaining('gioco o tabacco') });
      expect(con((r) => { r.contenuti[2].tema = 'Le sigarette elettroniche'; })).toMatchObject({ ok: false });
      const tabacchi = pianoDelPrimoMese({ nome: 'Bar Tabacchi Roma', tipo: 'bar', fascia: 'business', visitaIl: '2026-12-03T09:00:00Z' });
      const r = buono(); r.contenuti[0].didascalia = 'Buongiorno dal Bar Tabacchi Roma #BarTabacchiRoma';
      expect(pianoDallaRisposta(r, tabacchi, 'business').ok).toBe(true);
    });
    it('un indirizzo email no', () => {
      expect(con((r) => { r.contenuti[3].didascalia = 'Scrivici a titolare@gmail.com'; })).toMatchObject({ ok: false, motivo: expect.stringContaining('email') });
    });
    it('le storie fuori dal Premium no', () => {
      expect(con((r) => { r.contenuti.push({ ...r.contenuti[0], data: partenza.periodo.al, tipo: 'Storia' }); })).toMatchObject({ ok: false, motivo: expect.stringContaining('storie') });
    });
    it('due contenuti nello stesso giorno no', () => {
      expect(con((r) => { r.contenuti[1].data = r.contenuti[0].data; })).toMatchObject({ ok: false, motivo: expect.stringContaining('stesso giorno') });
    });
    it('un evento in città senza la sua fonte non entra; con la fonte sì', () => {
      const r = buono();
      r.contenuti[0].in_citta = 'Mercato inventato';
      r.contenuti[1].in_citta = 'Mercato del sabato'; r.contenuti[1].fonte_evento = 'https://www.comune.piacenza.it/mercato';
      const e = pianoDallaRisposta(r, partenza, 'business');
      expect(e.ok).toBe(true);
      if (e.ok) {
        expect(e.piano.contenuti[0].inCitta).toBeNull();
        expect(e.piano.contenuti[1]).toMatchObject({ inCitta: 'Mercato del sabato', fonteEvento: 'https://www.comune.piacenza.it/mercato' });
      }
    });
  });
});

describe('«scarica i miei dati» del titolare non fa uscire l email dell agente (collaudo del 27/11)', () => {
  const rotta = fs.readFileSync(path.join(process.cwd(), 'app/api/account/export/route.ts'), 'utf8');
  const colonne = (tabella: string) => {
    const m = rotta.match(new RegExp(`from\\('${tabella}'\\)\\.select\\('([^']*)'\\)`));
    return m ? m[1].split(',').map((c) => c.trim()) : null;
  };
  it('dell ordine di SDG escono solo abbonamento, canone, visita e date', () => {
    expect(colonne('ordini_sdg')).toEqual(['seller_id', 'nome_attivita', 'fascia', 'canone_centesimi', 'primo_mese_centesimi', 'visita_il', 'accettato_il', 'creato_il']);
  });
  it('del preventivo non escono il codice, l agente né la sua scheda', () => {
    const c = colonne('preventivi_con_codice');
    expect(c).not.toBeNull();
    for (const vietata of ['*', 'codice', 'agente_email', 'lavoro']) expect(c).not.toContain(vietata);
  });
});
