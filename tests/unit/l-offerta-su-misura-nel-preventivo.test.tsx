/**
 * @vitest-environment jsdom
 */
/**
 * 24/11/2026 — L'OFFERTA SU MISURA DENTRO IL PREVENTIVO.
 *
 * Nicola: «sulla base dei dati che hai recuperato sul cliente devi trovare esattamente tutte le cose che
 * possiamo offrirgli con i nostri servizi… dentro il preventivo deve esserci un'offerta personalizzata».
 *
 *  · ogni proposta nasce da un dato vero (vetrina, scheda di n8n, analisi dei canali, analisi del sito) e lo cita;
 *  · senza il dato, niente proposta e niente numero;
 *  · ogni proposta dice da quale abbonamento è compresa, secondo il listino (video e risposte alle
 *    recensioni dal Business);
 *  · nel link col codice solo i dati confermati;
 *  · per abbonamento (Nicola, 24/11 sera: «il servizio deve essere anche in base all'abbonamento»): stessi
 *    dati, cosa facciamo con la fascia scelta, e in breve cosa aggiunge quella sopra; quantità solo da FASCE;
 *  · l'avviso a Nicola dice cosa fare nella fascia scelta.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { cosaInFascia, inPiuSalendo, offertaSuMisura, proposteDi, testoOffertaPerAvviso, type DatiPerLOfferta } from '@/lib/agenzia/offerta-su-misura';
import { SchedaInArrivo, soloConfermati } from '@/lib/agenzia/scheda-cliente';
import { riassumiPageSpeed, leggiAnalisiCanali } from '@/lib/agenzia/analisi';
import { costruisciPreventivo, leggiImpostazioniAgenzia, testoAvvisoPreventivo } from '@/lib/agenzia/preventivo';
import OffertaSuMisura from '@/components/seller/OffertaSuMisura';

const ID = '0de1905e-7000-4000-8000-000000000001';
const VUOTA: DatiPerLOfferta = { nome: 'Ora del Gusto', tipo: 'bar', dati: { storeLogo: null, storeMedia: [], prodotti: [], socials: null } };

const scheda = SchedaInArrivo.parse({
  tipo: 'scheda-cliente', id_attivita: ID,
  campi: {
    indirizzo: { valore: 'Via Roma 10, Piacenza', stato: 'confermato', fonte: 'https://example.org' },
    orari: { valore: 'Lun–Sab 7.00–19.30', stato: 'da_confermare', fonte: 'https://example.org' },
    link_prenotazione: { valore: 'https://prenota.example.org/oradelgusto', stato: 'da_confermare', fonte: 'https://example.org' },
    menu_testo: { valore: 'Brioche alla crema\nTorta di mele\nCannoli\nCappuccino 1,50 €', stato: 'confermato', fonte: null },
  },
  analisi: {
    punti_di_forza: ['Brioche fatte in casa'],
    idee_contenuti: ['Il laboratorio alle 6 del mattino, in video', 'Colazione a 2,50 €', 'La torta della domenica'],
    cosa_chiedere_al_titolare: ['Fate torte su ordinazione?'],
  },
});
const canali = leggiAnalisiCanali({
  tipo: 'analisi-canali', id_attivita: ID, fatta_il: '2026-11-24T09:00:00Z',
  canali: {
    instagram: { stato: 'fatta', fonte: 'https://www.instagram.com/oradelgusto/', numeri: { follower: 812, post_ultimi_30_giorni: 3 } },
    facebook: { stato: 'non_trovato' },
    google: { stato: 'fatta', fonte: 'https://maps.app.goo.gl/AbC123', numeri: { valutazione: 4.6, recensioni: 128 }, osservazioni: ['Mancano gli orari della domenica'] },
  },
});
const sito = riassumiPageSpeed(
  { lighthouseResult: { categories: { performance: { score: 0.42 }, seo: { score: 0.83 }, accessibility: { score: 0.95 } }, audits: { 'largest-contentful-paint': { numericValue: 5200 }, 'meta-description': { score: 0 } } } },
  'https://www.oradelgusto.it/', new Date('2026-11-24T09:30:00Z'),
);
const PIENA: DatiPerLOfferta = {
  nome: 'Ora del Gusto',
  tipo: 'bar',
  dati: {
    storeLogo: null,
    storeMedia: [{ type: 'image', url: 'https://x.it/1.jpg' }],
    prodotti: [...Array.from({ length: 18 }, () => ({ images: ['https://x.it/p.jpg'] })), ...Array.from({ length: 12 }, () => ({ images: [] }))],
    socials: { instagram: 'oradelgusto', facebook: 'oradelgusto', website: 'https://www.oradelgusto.it', google_maps: 'https://maps.app.goo.gl/AbC123' },
  },
  scheda,
  canali,
  sito,
};

const ids = (d: DatiPerLOfferta) => offertaSuMisura(d).proposte.map((x) => x.id);

describe('le proposte nascono dai dati veri', () => {
  it('con tutti i dati: le cose precise per quel locale, coi numeri letti', () => {
    const o = offertaSuMisura(PIENA);
    const per = (id: string) => o.proposte.find((x) => x.id === id)!;
    expect(per('foto-prodotti').cosa).toBe('Fotografiamo i tuoi 12 prodotti senza foto');
    expect(per('foto-prodotti').perche).toContain('Su 30 prodotti in catalogo, 12 non hanno nessuna foto');
    expect(per('foto-copertina').perche).toContain('ha 1 foto del locale');
    expect(per('video-presentazione').daFascia).toBe('business');
    expect(per('sito-prenota').cosa).toContain('Prenota');
    expect(per('sito-rifatto').perche).toContain('42 su 100');
    expect(per('sito-rifatto').perche).toContain('Manca la descrizione');
    expect(per('sito-rifatto').fonte).toBe('Google PageSpeed Insights');
    expect(cosaInFascia(per('sito-rifatto'), 'base')).toContain('in una pagina');
    expect(cosaInFascia(per('foto-prodotti'), 'base')).toBe('Fotografiamo i prodotti principali fra i 12 senza foto, nella sessione di foto all’avvio');
    expect(cosaInFascia(per('foto-prodotti'), 'business')).toContain('ogni tre mesi');
    expect(cosaInFascia(per('social-costanza'), 'base')).toBe('Da 3 a 8 post al mese su Instagram, preparati e pubblicati da noi');
    expect(cosaInFascia(per('social-costanza'), 'business')).toContain('Da 3 a 12 post al mese');
    expect(cosaInFascia(per('social-costanza'), 'premium')).toContain('Da 3 a 20 post al mese');
    expect(per('social-costanza').perche).toContain('812 persone');
    expect(per('social-facebook').perche).toContain('non l’abbiamo trovata');
    expect(per('social-idee').cosa).toContain('il laboratorio alle 6 del mattino');
    expect(per('social-idee').cosa).not.toContain('2,50');
    expect(per('social-video-brevi').daFascia).toBe('business');
    expect(per('google-sistema-0').perche).toBe('Mancano gli orari della domenica');
    expect(per('google-recensioni').perche).toContain('128 recensioni e 4,6 stelle');
    expect(per('google-recensioni').daFascia).toBe('business');
    expect(per('google-orari').perche).toContain('Lun–Sab 7.00–19.30');
    expect(cosaInFascia(per('analisi'), 'base')).toContain('all’avvio');
    expect(cosaInFascia(per('analisi'), 'business')).toContain('ogni mese');
    expect(cosaInFascia(per('analisi'), 'premium')).toContain('un incontro al mese');
    expect(cosaInFascia(per('video-presentazione'), 'base')).toBeNull();
    expect(cosaInFascia(per('google-recensioni'), 'base')).toBeNull();
    expect(o.domande).toEqual(['Fate torte su ordinazione?']);
    // chi ha già il sito non si vede proporre un sito nuovo; chi ha la scheda Google non si vede proporre di crearla
    expect(ids(PIENA)).not.toContain('sito-nuovo');
    expect(ids(PIENA)).not.toContain('google-scheda');
    expect(o.tuttoCon).toBe('business');
    expect(o.perFascia.premium).toBe(o.proposte.length);
    expect(o.perFascia.base).toBe(o.proposte.filter((x) => x.daFascia === 'base').length);
  });

  it('senza scheda e senza analisi: niente numeri dei canali né del sito, solo quello che dice la vetrina', () => {
    const o = offertaSuMisura(VUOTA);
    expect(o.proposte.map((x) => x.id)).toEqual(['foto-copertina', 'video-presentazione', 'sito-nuovo', 'social-apertura', 'google-scheda', 'analisi']);
    const testo = JSON.stringify(o);
    expect(testo).not.toMatch(/su 100|\d+ recension|follower|persone ti seguono|stelle/);
    expect(o.domande).toEqual([]);
  });

  it('un catalogo grande porta le proposte del Premium', () => {
    const grande: DatiPerLOfferta = { ...VUOTA, dati: { ...VUOTA.dati, prodotti: Array.from({ length: 160 }, () => ({ images: ['https://x.it/p.jpg'] })) } };
    const o = offertaSuMisura(grande);
    expect(o.proposte.find((x) => x.id === 'foto-ogni-mese')?.daFascia).toBe('premium');
    expect(o.proposte.find((x) => x.id === 'sito-piu-pagine')?.cosa).toContain('160 prodotti');
    expect(o.tuttoCon).toBe('premium');
  });

  it('nel link col codice (solo dati confermati, nessuna analisi) le idee e gli orari da confermare non entrano', () => {
    const pubblica = offertaSuMisura({ ...PIENA, scheda: soloConfermati(scheda), canali: null, sito: null });
    const tutto = JSON.stringify(pubblica);
    expect(tutto).not.toContain('laboratorio');
    expect(tutto).not.toContain('Lun–Sab');
    expect(tutto).not.toContain('prenota');
    expect(tutto).not.toContain('128');
    expect(pubblica.domande).toEqual([]);
  });

  it('le correzioni del collaudo: niente cali spacciati per aumenti, niente Facebook mai scritto, niente telefoni', () => {
    // chi pubblica già 30 post al mese non si vede promettere «da 30 a 8»
    const tanti = leggiAnalisiCanali({ tipo: 'analisi-canali', id_attivita: ID, fatta_il: '2026-11-24T09:00:00Z', canali: { instagram: { stato: 'fatta', numeri: { post_ultimi_30_giorni: 30 } } } });
    expect(ids({ ...PIENA, canali: tanti })).not.toContain('social-costanza');
    const dieci = leggiAnalisiCanali({ tipo: 'analisi-canali', id_attivita: ID, fatta_il: '2026-11-24T09:00:00Z', canali: { instagram: { stato: 'fatta', numeri: { post_ultimi_30_giorni: 10 } } } });
    const c = offertaSuMisura({ ...PIENA, canali: dieci }).proposte.find((x) => x.id === 'social-costanza')!;
    expect(c.daFascia).toBe('business');
    expect(cosaInFascia(c, 'base')).toBeNull();
    // Facebook non scritto dal titolare: niente «la pagina che ci hai scritto»
    const soloIg = { ...PIENA, dati: { ...PIENA.dati, socials: { instagram: 'oradelgusto' } } };
    expect(ids(soloIg)).not.toContain('social-facebook');
    // telefoni nelle idee e negli orari non escono
    const conTelefoni = SchedaInArrivo.parse({
      tipo: 'scheda-cliente', id_attivita: ID,
      campi: { orari: { valore: 'Lun–Ven 7.00–20.00, info 333 1234567', stato: 'da_confermare', fonte: 'https://example.org' } },
      analisi: { idee_contenuti: ['Chiama Mario al 3331234567 per il reel'] },
    });
    const t = JSON.stringify(offertaSuMisura({ ...VUOTA, scheda: conTelefoni }));
    expect(t).not.toMatch(/333 ?1234567/);
    // l'analisi di un sito senza il sito scritto non fa proporre di rifarlo
    expect(ids({ ...PIENA, dati: { ...PIENA.dati, socials: {} } })).not.toContain('sito-rifatto');
  });

  it('proposteDi dà solo quelle del servizio', () => {
    const o = offertaSuMisura(PIENA);
    expect(proposteDi(o, 'sito_web').every((x) => x.servizio === 'sito_web')).toBe(true);
    expect(proposteDi(o, 'sito_web').length).toBeGreaterThan(0);
  });
});

describe('dove si vede', () => {
  const accesi: Root[] = [];
  afterEach(() => {
    for (const r of accesi.splice(0)) act(() => r.unmount());
    document.body.innerHTML = '';
  });
  async function monta(el: React.ReactElement) {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    accesi.push(root);
    await act(async () => { root.render(el); });
    return radice;
  }

  it('col Base: cosa facciamo per lui col Base, e sotto cosa aggiunge il Business', async () => {
    const o = offertaSuMisura(PIENA);
    const r = await monta(createElement(OffertaSuMisura, { offerta: o, fascia: 'base' }));
    expect(r.textContent).toContain('La tua offerta su misura, col Base');
    expect(r.querySelector('[data-proposta="foto-prodotti"]')!.textContent).toContain('prodotti principali');
    expect(r.querySelector('[data-proposta="social-costanza"]')!.textContent).toContain('Da 3 a 8 post al mese');
    // il video non è nel Base: non c'è fra le cose comprese, c'è fra quelle in più col Business
    expect(r.querySelector('[data-proposta="video-presentazione"]')).toBeNull();
    const inPiu = r.querySelector('[data-testid="offerta-in-piu"]')!;
    expect(inPiu.textContent).toContain('Col Business, in più per te');
    expect(inPiu.querySelector('[data-in-piu="video-presentazione"]')).not.toBeNull();
    expect(inPiu.querySelector('[data-in-piu="social-costanza"]')!.textContent).toContain('12 post al mese');
    expect(inPiu.querySelector('[data-in-piu="google-recensioni"]')).not.toBeNull();
    expect(r.textContent).toContain('Al primo incontro ti chiediamo');
  });

  it('col Premium: tutto compreso, coi ritmi del Premium, e niente «in più»', async () => {
    const o = offertaSuMisura(PIENA);
    const r = await monta(createElement(OffertaSuMisura, { offerta: o, fascia: 'premium' }));
    expect(r.querySelector('[data-proposta="analisi"]')!.textContent).toContain('ogni settimana');
    expect(r.querySelector('[data-proposta="social-costanza"]')!.textContent).toContain('20 post al mese');
    expect(r.querySelector('[data-testid="offerta-in-piu"]')).toBeNull();
    expect(inPiuSalendo(o, 'premium')).toBeNull();
  });

  it('nella pagina di un servizio solo le sue proposte, senza riepilogo', async () => {
    const o = offertaSuMisura(PIENA);
    const r = await monta(createElement(OffertaSuMisura, { offerta: o, fascia: 'business', servizi: ['foto_video'], completa: false, titolo: 'Cosa facciamo per te, col Business' }));
    expect(Array.from(r.querySelectorAll('[data-proposta]')).map((x) => x.getAttribute('data-proposta'))).toEqual(['foto-prodotti', 'foto-copertina', 'video-presentazione']);
    expect(r.querySelector('[data-testid="offerta-riepilogo"]')).toBeNull();
    expect(r.querySelector('[data-testid="offerta-in-piu"]')!.textContent).toContain('ogni mese');
  });

  it('senza offerta non si disegna niente', async () => {
    const r = await monta(createElement(OffertaSuMisura, { offerta: undefined, fascia: 'base' }));
    expect(r.textContent).toBe('');
  });

  it('l avviso a Nicola dice cosa fare per lui, solo quello compreso dalla fascia scelta', () => {
    const p = costruisciPreventivo({
      idAttivita: ID, nomeAttivita: 'Ora del Gusto', tipoAttivita: 'bar', dati: PIENA.dati,
      impostazioni: leggiImpostazioniAgenzia({}), adesso: new Date('2026-11-24T10:00:00Z'), scelto: 'base',
    });
    p.offerta = offertaSuMisura(PIENA);
    const testo = testoAvvisoPreventivo(p, null) + testoOffertaPerAvviso(p.offerta, 'base');
    expect(testo).toContain('Da fare per lui col Base: Fotografiamo i prodotti principali fra i 12 senza foto');
    expect(testo).not.toContain('Giriamo');
    vi.restoreAllMocks();
  });
});
