/**
 * 25/11/2026 sera — SITO E SOCIAL SI OFFRONO SOLO DOVE VALGONO DI PIÙ (Nicola, «ok sito»), e il collaudo del ramo.
 *
 * Le regole (registro dei fatti, `agenzia.sito-solo-dove-vale-di-piu` e `agenzia.social-come-il-sito`):
 *  · la tabella del sito non dipende dai voti di Google: medio → rifatto dal Business, pregio → solo Premium con le migliorie;
 *  · le frasi dicono il vero a occhio e per Google: mai «fatto bene» accanto a voti bassi;
 *  · un sito noto senza misura conta come sito (vetrina, misura, `campi.sito_ufficiale`): mai «non hai un sito»;
 *  · i social per livello (nessuno, debole, attivo, forte), anche nel link pubblico; mai «nessun profilo» se l'abbiamo trovato;
 *  · le risposte alle recensioni dal Business, solo se oggi il locale non risponde;
 *  · l'analisi del business «fatta, ma senza fonti» lo dice, invece di «la stiamo preparando» per sempre.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cosaInFascia, leggiGiudizioSito, offertaSuMisura, sitoDaRifareInQualcheFascia, type DatiPerLOfferta, type GiudizioSito } from '@/lib/agenzia/offerta-su-misura';
import { ANALISI_SENZA_FONTI, leggiAnalisiCanali, livelloSocial, riassumiPageSpeed, statoAnalisiBusiness, type AnalisiCanali } from '@/lib/agenzia/analisi';
import { consigliataDallOfferta, ABBONAMENTI } from '@/lib/agenzia/preventivo';
import { SchedaInArrivo } from '@/lib/agenzia/scheda-cliente';
import AnalisiAziendale from '@/components/seller/AnalisiAziendale';

const ID = '0de1905e-7000-4000-8000-000000000007';
const pagespeed = (perf: number, seo: number, audits: Record<string, unknown> = {}) =>
  riassumiPageSpeed({ lighthouseResult: { categories: { performance: { score: perf }, seo: { score: seo }, accessibility: { score: 0.95 } }, audits } }, 'https://www.esempio.it/', new Date('2026-11-25T09:00:00Z'));
const LENTO = pagespeed(0.4, 0.95);
const VELOCE = pagespeed(0.95, 0.95);
const SEO_MALE = pagespeed(0.95, 0.6, { 'meta-description': { score: 0 } });
const g = (x: Partial<GiudizioSito>): GiudizioSito => leggiGiudizioSito(x)!;
const MIGLIORIE = 'Le prenotazioni dal telefono e il menu tradotto in inglese';

const conSito = (sito: DatiPerLOfferta['sito'], giudizioSito: GiudizioSito | null, socials: Record<string, string> | null = { website: 'https://www.esempio.it' }): DatiPerLOfferta => ({
  nome: 'Esempio', tipo: 'ristorante', sito, giudizioSito,
  dati: { storeLogo: null, storeMedia: [], prodotti: [], socials },
});
const sitoDi = (d: DatiPerLOfferta) => offertaSuMisura(d).proposte.find((x) => x.servizio === 'sito_web' && x.id.startsWith('sito-'))!;
const testi = (d: DatiPerLOfferta) => offertaSuMisura(d).proposte.flatMap((x) => [x.cosa, x.perche, ...Object.values(x.perFascia ?? {})]).join(' \n ');

describe('1 · la tabella del sito non dipende da Google', () => {
  it('medio e a posto per Google: tenuto e collegato nel Base, rifatto dal Business e nel Premium', () => {
    const x = sitoDi(conSito(VELOCE, g({ livello: 'medio' })));
    expect(cosaInFascia(x, 'base')).toMatch(/^Colleghiamo/);
    expect(cosaInFascia(x, 'business')).toMatch(/^Rifacciamo/);
    expect(cosaInFascia(x, 'premium')).toMatch(/^Rifacciamo/);
  });

  it('pregio con migliorie e a posto per Google: rifatto solo nel Premium', () => {
    const x = sitoDi(conSito(VELOCE, g({ livello: 'pregio', migliorie: MIGLIORIE })));
    expect(cosaInFascia(x, 'business')).not.toMatch(/Rifacciamo/);
    expect(cosaInFascia(x, 'premium')).toMatch(/^Rifacciamo/);
  });

  it('pregio senza migliorie non si rifà mai, qualunque cosa dica Google', () => {
    for (const s of [LENTO, VELOCE, SEO_MALE, null]) expect(sitoDi(conSito(s, g({ livello: 'pregio' }))).id).toBe('sito-valorizzato');
  });
});

describe('1 · le frasi dicono il vero a occhio e per Google', () => {
  const misure = [LENTO, VELOCE, SEO_MALE, null];
  const giudizi = [null, g({ livello: 'semplice' }), g({ livello: 'medio' }), g({ livello: 'pregio' }), g({ livello: 'pregio', migliorie: MIGLIORIE }), g({ aspetto: 'curato' })];

  it('mai «fatto bene» se lo stesso preventivo mostra un voto sotto 90', () => {
    for (const s of misure) for (const gi of giudizi) {
      const t = testi(conSito(s, gi));
      const votoBasso = !!s && ((s.velocita ?? 100) < 90 || (s.seo ?? 100) < 90);
      if (votoBasso) expect(t, JSON.stringify(gi)).not.toMatch(/fatto bene/i);
    }
  });

  it('«senza le cose che Google segnala» solo se Google segnala qualcosa', () => {
    for (const s of misure) for (const gi of giudizi) {
      const t = testi(conSito(s, gi));
      const segnala = !!s && ((s.seo ?? 100) < 90 || s.daSistemare.length > 0);
      if (!segnala) expect(t, `${JSON.stringify(s)} ${JSON.stringify(gi)}`).not.toMatch(/cose che Google segnala/);
    }
  });

  it('nemmeno se è bassa la sola facilità d’uso, che il preventivo mostra nella riga del sito (dal collaudo)', () => {
    const difficile = riassumiPageSpeed({ lighthouseResult: { categories: { performance: { score: 0.95 }, seo: { score: 0.95 }, accessibility: { score: 0.4 } }, audits: {} } }, 'https://www.esempio.it/', new Date('2026-11-25T09:00:00Z'));
    for (const gi of [g({ livello: 'pregio' }), g({ livello: 'medio' }), null]) {
      const t = testi(conSito(difficile, gi));
      expect(t).not.toMatch(/fatto bene|va già bene/i);
      expect(t).toContain('40 su 100');
    }
  });

  it('un sito di pregio lento lo dice: niente «fatto bene», e il voto di Google c’è', () => {
    const x = sitoDi(conSito(LENTO, g({ livello: 'pregio' })));
    expect(x.perche).not.toMatch(/fatto bene/i);
    expect(x.perche).toContain('40 su 100');
  });
});

describe('2 · un sito noto senza la misura di Google conta come sito', () => {
  it('dalla vetrina (o dal modulo 12): niente «non hai un sito», vale medio e si rifà dal Business', () => {
    const o = offertaSuMisura(conSito(null, null));
    expect(o.proposte.some((x) => x.id === 'sito-nuovo')).toBe(false);
    const x = o.proposte.find((p) => p.id === 'sito-rifatto')!;
    expect(cosaInFascia(x, 'base')).toMatch(/^Colleghiamo/);
    expect(cosaInFascia(x, 'business')).toMatch(/^Rifacciamo/);
    expect(testi(conSito(null, null))).not.toMatch(/non hai (ancora )?un sito/i);
  });

  it('dalla scheda (`campi.sito_ufficiale`): anche senza niente nella vetrina', () => {
    const scheda = SchedaInArrivo.parse({ tipo: 'scheda-cliente', id_attivita: ID, campi: { sito_ufficiale: { valore: 'https://www.esempio.it', stato: 'confermato', fonte: 'https://www.esempio.it' } } });
    const d = { ...conSito(null, null, null), scheda };
    expect(offertaSuMisura(d).proposte.some((x) => x.id === 'sito-nuovo')).toBe(false);
    expect(testi(d)).not.toMatch(/non hai (ancora )?un sito/i);
  });

  it('la bozza va a chi ha un sito se almeno una fascia lo rifà: senza giudizio sì (medio), pregio senza migliorie no', () => {
    expect(sitoDaRifareInQualcheFascia(null)).toBe(true);
    expect(sitoDaRifareInQualcheFascia(g({ livello: 'medio' }))).toBe(true);
    expect(sitoDaRifareInQualcheFascia(g({ livello: 'pregio' }))).toBe(false);
    expect(sitoDaRifareInQualcheFascia(g({ livello: 'pregio', migliorie: MIGLIORIE }))).toBe(true);
  });
});

/* ─────────── 3 · i social ─────────── */
const canali = (c: Record<string, unknown>): AnalisiCanali =>
  leggiAnalisiCanali({ tipo: 'analisi-canali', id_attivita: ID, fatta_il: '2026-11-25T18:00:00Z', canali: c })!;
const ig = (post: number, video: boolean, extra: Record<string, unknown> = {}) => ({
  stato: 'fatta', fonte: 'https://www.instagram.com/esempio',
  numeri: { post_ultimi_30_giorni: post, follower: 900 },
  giudizio: { livello: 'attivo', post_al_mese: post, video, cura: 'curato', risposte_recensioni: null, migliorie: null, non_trovato: [], ...extra },
});
const conSocial = (c: AnalisiCanali | null, socials: Record<string, string> | null = { instagram: 'esempio' }): DatiPerLOfferta => ({
  nome: 'Esempio', tipo: 'bar', canali: c, dati: { storeLogo: null, storeMedia: [], prodotti: [], socials },
});
const igDi = (d: DatiPerLOfferta) => offertaSuMisura(d).proposte.find((x) => x.id === 'social-costanza');

describe('3 · i livelli dei social', () => {
  it('il giudizio dell’AD arriva fino al sito (non si scarta più)', () => {
    const c = canali({ instagram: ig(10, false, { livello: 'stellare', migliorie: 'Costa 300 € al mese' }) });
    expect(c.canali.instagram!.giudizio).toMatchObject({ post_al_mese: 10, video: false, cura: 'curato', livello: null, migliorie: null });
  });

  it('debole, attivo, forte, nessuno', () => {
    expect(livelloSocial(canali({ instagram: ig(3, false) }).canali.instagram)).toBe('debole');
    expect(livelloSocial(canali({ instagram: ig(10, false) }).canali.instagram)).toBe('attivo');
    expect(livelloSocial(canali({ instagram: ig(20, true) }).canali.instagram)).toBe('forte');
    expect(livelloSocial(canali({ instagram: { stato: 'non_trovato' } }).canali.instagram)).toBe('nessuno');
    // senza il conto dei post vale il livello scritto dall'AD (N8N#16, 119c57e)
    expect(livelloSocial(canali({ instagram: { stato: 'fatta', fonte: 'https://www.instagram.com/x', giudizio: { livello: 'forte', video: true } } }).canali.instagram)).toBe('forte');
    expect(livelloSocial(canali({ instagram: { stato: 'privato', fonte: 'https://www.instagram.com/x' } }).canali.instagram)).toBeNull();
  });

  it('debole: la gestione dal Base', () => {
    const x = igDi(conSocial(canali({ instagram: ig(3, false) })))!;
    expect(x.daFascia).toBe('base');
    expect(cosaInFascia(x, 'base')).toMatch(/post al mese/);
  });

  it('attivo: nel Base si tiene e si collega, la gestione dalla prima fascia che fa più post o video di oggi', () => {
    const x = igDi(conSocial(canali({ instagram: ig(10, false) })))!;
    expect(cosaInFascia(x, 'base')).toMatch(/^Teniamo/);
    expect(cosaInFascia(x, 'business')).toMatch(/12 post al mese/);
    expect(x.consiglia?.fascia).toBe('business');
    // 12 post con video: il Business non fa di più, la gestione parte dal Premium
    const y = igDi(conSocial(canali({ instagram: ig(12, true) })))!;
    expect(cosaInFascia(y, 'business')).toMatch(/^Teniamo/);
    expect(cosaInFascia(y, 'premium')).toMatch(/20 post al mese/);
  });

  it('forte: tenuto nel Base e nel Business, gestito solo nel Premium e solo con le migliorie dell’AD', () => {
    const senza = igDi(conSocial(canali({ instagram: ig(20, true) })))!;
    for (const f of ABBONAMENTI) expect(cosaInFascia(senza, f)).toMatch(/^Teniamo/);
    const con = igDi(conSocial(canali({ instagram: ig(20, true, { migliorie: 'Le storie ogni giorno col piatto del giorno' }) })))!;
    expect(cosaInFascia(con, 'business')).toMatch(/^Teniamo/);
    expect(cosaInFascia(con, 'premium')).toContain('le storie ogni giorno col piatto del giorno');
    expect(con.consiglia?.fascia).toBe('premium');
  });

  it('i confini: 8 post è attivo, più di 12 senza video resta attivo', () => {
    expect(livelloSocial(canali({ instagram: ig(7, false) }).canali.instagram)).toBe('debole');
    expect(livelloSocial(canali({ instagram: ig(8, false) }).canali.instagram)).toBe('attivo');
    expect(livelloSocial(canali({ instagram: ig(20, false) }).canali.instagram)).toBe('attivo');
  });

  it('con un canale forte (o attivo) il Base non promette i post né i video: le idee partono da dove parte la gestione (dal collaudo)', () => {
    const scheda = SchedaInArrivo.parse({ tipo: 'scheda-cliente', id_attivita: ID, campi: {}, analisi: { idee_contenuti: ['Video dietro le quinte in cucina', 'La torta della domenica'] } });
    const forte = offertaSuMisura({ ...conSocial(canali({ instagram: ig(20, true) })), scheda });
    for (const id of ['social-idee', 'social-video-brevi']) expect(forte.proposte.some((x) => x.id === id), id).toBe(false);
    const attivo = offertaSuMisura({ ...conSocial(canali({ instagram: ig(10, false) })), scheda });
    expect(cosaInFascia(attivo.proposte.find((x) => x.id === 'social-idee')!, 'base')).toBeNull();
    expect(cosaInFascia(attivo.proposte.find((x) => x.id === 'social-idee')!, 'business')).not.toBeNull();
  });

  it('un profilo privato conta come profilo: niente «nessun profilo»', () => {
    const d = conSocial(canali({ instagram: { stato: 'privato', fonte: 'https://www.instagram.com/x' } }), null);
    expect(offertaSuMisura(d).proposte.some((x) => x.id === 'social-apertura')).toBe(false);
  });

  it('senza sapere se risponde, le risposte alle recensioni non si offrono', () => {
    const c = canali({ google: { stato: 'fatta', fonte: 'https://maps.google.com/?cid=1', numeri: { recensioni: 210 } } });
    expect(offertaSuMisura(conSocial(c)).proposte.some((x) => x.id === 'google-recensioni')).toBe(false);
  });

  it('senza analisi del canale: niente frasi sul canale oltre la parte generale', () => {
    expect(igDi(conSocial(null))).toBeUndefined();
  });

  it('mai «nessun profilo» se un profilo l’abbiamo trovato, anche se non è scritto nella vetrina', () => {
    const d = conSocial(canali({ instagram: ig(3, false) }), null);
    expect(offertaSuMisura(d).proposte.some((x) => x.id === 'social-apertura')).toBe(false);
    expect(testi(d)).not.toMatch(/nessun profilo/i);
  });

  it('le risposte alle recensioni dal Business, solo se oggi il locale non risponde', () => {
    const google = (risponde: boolean) => canali({ google: { stato: 'fatta', fonte: 'https://maps.google.com/?cid=1', numeri: { recensioni: 210, valutazione: 4.6 }, giudizio: { risposte_recensioni: risponde } } });
    const r = (c: AnalisiCanali) => offertaSuMisura(conSocial(c)).proposte.find((x) => x.id === 'google-recensioni');
    expect(r(google(true))).toBeUndefined();
    expect(r(google(false))!.daFascia).toBe('business');
  });

  it('il consiglio tiene conto del livello dei social', () => {
    const c = consigliataDallOfferta({ id: 'base', perche: 'La tua vetrina è già in ordine.' }, offertaSuMisura(conSocial(canali({ instagram: ig(10, false) }))));
    expect(c.id).toBe('business');
  });
});

describe('4 · l’analisi del business «fatta, ma senza fonti»', () => {
  const vuota = SchedaInArrivo.parse({ tipo: 'scheda-cliente', id_attivita: ID, campi: {}, analisi: { business_fatta_il: '2026-11-25T18:00:00Z', business_avvisi: ['Nessuna fonte pubblica sul locale.'] } });

  it('tre stati: fatta, senza fonti, da fare', () => {
    expect(statoAnalisiBusiness(vuota)).toBe('senza_fonti');
    expect(statoAnalisiBusiness(SchedaInArrivo.parse({ tipo: 'scheda-cliente', id_attivita: ID, campi: {} }))).toBe('da_fare');
  });

  it('il preventivo e la pagina Analisi lo dicono, invece di «la stiamo preparando»', () => {
    for (const corta of [true, false]) {
      const html = renderToStaticMarkup(<AnalisiAziendale analisi={null} stato="senza_fonti" corta={corta} fascia="business" />);
      expect(html).toContain(ANALISI_SENZA_FONTI);
      expect(html).not.toMatch(/stiamo preparando/);
    }
  });
});

/* ─────────── i collegamenti col database ─────────── */
const tabelle: Record<string, unknown> = {};
const selezioni: Record<string, string[]> = {};
function query(tabella: string) {
  const righe = () => { const v = tabelle[tabella]; return Array.isArray(v) ? v : v ? [v] : []; };
  const q: Record<string, unknown> = {};
  for (const m of ['eq', 'in', 'order', 'limit', 'not']) q[m] = () => q;
  q.select = (s: string) => { (selezioni[tabella] ??= []).push(s); return q; };
  q.maybeSingle = async () => ({ data: righe()[0] ?? null, error: null });
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve({ data: righe(), error: null }).then(ok, ko);
  return q;
}
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ from: (t: string) => query(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: () => undefined, warn: () => undefined, info: () => undefined } }));

describe('i collegamenti: leggi-preventivo e bozze-in-attesa', () => {
  beforeEach(() => {
    for (const k of Object.keys(tabelle)) delete tabelle[k];
    for (const k of Object.keys(selezioni)) delete selezioni[k];
  });

  it('nel link pubblico entrano i social, il sito della scheda conta come sito, l’analisi senza fonti si dice', async () => {
    const { leggiPreventivo } = await import('@/lib/agenzia/leggi-preventivo');
    tabelle.profiles = { id: ID, role: 'seller', store_name: 'La Ragazzetta', business_type: 'bar', store_customization: { socials: {} } };
    tabelle.products = [];
    tabelle.schede_clienti = { scheda: { tipo: 'scheda-cliente', id_attivita: ID, campi: { sito_ufficiale: { valore: 'https://www.laragazzetta.it', stato: 'confermato', fonte: 'https://www.laragazzetta.it' } }, analisi: { business_fatta_il: '2026-11-25T18:00:00Z', business_avvisi: [] } } };
    tabelle.analisi_negozi = { sito: null, canali: { tipo: 'analisi-canali', id_attivita: ID, fatta_il: '2026-11-25T18:00:00Z', canali: { instagram: ig(10, false) } } };
    const { preventivo } = await leggiPreventivo(ID, undefined, { pubblico: true });
    const ids = preventivo.offerta!.proposte.map((x) => x.id);
    expect(ids).toContain('social-costanza');
    expect(ids).not.toContain('sito-nuovo');
    expect(ids).not.toContain('social-apertura');
    expect(preventivo.analisiAziendaleStato).toBe('senza_fonti');
    expect(preventivo.canali?.canali.instagram?.stato).toBe('fatta');
    expect(JSON.stringify(preventivo.righe)).not.toMatch(/non ha ancora un sito|Nessun profilo social/);
    // il titolare non ha scritto niente: niente «ci hai scritto Instagram» (dal collaudo)
    expect(JSON.stringify(preventivo)).not.toMatch(/Ci hai scritto|Ci hai dato \d/);
    // il sito si rifà dal Business: la pagina del servizio non dice «ce l'hai già»
    expect(preventivo.giaAPosto).not.toContain('sito_web');
    // il consiglio arriva davvero nel preventivo letto: sito medio e Instagram attivo portano al Business
    expect(preventivo.consigliato).toBe('business');
  });

  it('nel link, prima dell abbonamento, un sito della scheda non confermato non decide le frasi', async () => {
    const { leggiPreventivo } = await import('@/lib/agenzia/leggi-preventivo');
    tabelle.profiles = { id: ID, role: 'seller', store_name: 'Omonimo', business_type: 'bar', store_customization: { socials: {} } };
    tabelle.products = [];
    tabelle.schede_clienti = { scheda: { tipo: 'scheda-cliente', id_attivita: ID, campi: { sito_ufficiale: { valore: 'https://www.omonimo.it', stato: 'da_confermare', fonte: 'https://www.omonimo.it' } } } };
    tabelle.analisi_negozi = null;
    const { preventivo } = await leggiPreventivo(ID, undefined, { pubblico: true });
    expect(preventivo.offerta!.proposte.some((x) => x.id === 'sito-rifatto')).toBe(false);
  });

  it('telefoni ed email nelle osservazioni dei canali non escono', () => {
    const c = canali({
      instagram: { ...ig(3, false), osservazioni: ['In bio c’è il cellulare del titolare 347 1234567', 'Scrivete a mario.rossi@gmail.com per gli ordini', 'Foto belle ma rare'] },
      google: { stato: 'fatta', fonte: 'https://maps.google.com/?cid=1', osservazioni: ['La scheda riporta info@laragazzetta.it come contatto'] },
    });
    expect(c.canali.instagram!.osservazioni).toEqual(['Foto belle ma rare']);
    expect(c.canali.google!.osservazioni).toEqual([]);
    expect(JSON.stringify(offertaSuMisura(conSocial(c)))).not.toMatch(/@|347/);
  });

  it('chi ha un sito senza giudizio aspetta la bozza; chi ha un sito di pregio senza migliorie no', async () => {
    const { negoziCheAspettanoLaBozza } = await import('@/lib/agenzia/bozze-in-attesa');
    const A = '0de1905e-7000-4000-8000-00000000000a';
    const B = '0de1905e-7000-4000-8000-00000000000b';
    const C = '0de1905e-7000-4000-8000-00000000000c';
    tabelle.profiles = [
      { id: A, role: 'seller', store_name: 'A', store_customization: { socials: { website: 'https://a.it' } } },
      { id: B, role: 'seller', store_name: 'B', store_customization: { socials: { website: 'https://b.it' } } },
      // C non ha il sito nella vetrina: lo conosce la scheda
      { id: C, role: 'seller', store_name: 'C', store_customization: { socials: {} } },
    ];
    tabelle.bozze_sito = [];
    tabelle.schede_clienti = [
      { id_attivita: B, aggiornata_il: '2026-11-25T10:00:00Z', giudizio: { livello: 'pregio' } },
      { id_attivita: C, aggiornata_il: '2026-11-25T10:00:00Z', giudizio: null, sito_ufficiale: 'https://c.it' },
    ];
    tabelle.abbonamenti_servizi = [];
    tabelle.analisi_negozi = [];
    const per = Object.fromEntries((await negoziCheAspettanoLaBozza()).map((n) => [n.id_attivita, n.perche]));
    expect(per[A]).toBe('sito_da_rifare');
    expect(per[B]).toBeUndefined();
    expect(per[C]).toBe('sito_da_rifare');
  });
});
