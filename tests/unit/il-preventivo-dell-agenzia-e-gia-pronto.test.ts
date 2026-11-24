import { describe, it, expect } from 'vitest';
import {
  ABBONAMENTI,
  FASCE,
  FRASE_PARTNER,
  FOTO_LOCALE_CONSIGLIATE,
  LISTINO,
  PRODOTTI_PER_IL_PREMIUM,
  CONDIZIONI,
  FRASE_CONDIZIONI,
  SCONTRINO_DI_PARTENZA,
  canonePrimoMese,
  cosaCiGuadagni,
  frasePareggio,
  pareggio,
  NOME_AGENZIA_DI_RISERVA,
  costruisciPreventivo,
  cosaManca,
  giornoDiPiacenza,
  leggiImpostazioniAgenzia,
  numeroPreventivo,
  testoAvvisoPreventivo,
  type DatiAttivita,
} from '@/lib/agenzia/preventivo';
import { scriviCanone } from '@/components/seller/preventivo-agenzia';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SERVIZI_AGENZIA } from '@/lib/agenzia/preventivo';

/**
 * 22/11/2026 — Nicola: la dashboard del cliente mostra «il preventivo di quello
 * che gli manca», già pronto. 24/11/2026 — Nicola: «ci sono 3 abbonamenti: base
 * 300€/mese, business 500€/mese e premium 999€/mese», ognuno comprende tutti i
 * servizi in misura diversa; i servizi non si vendono più uno per uno. Queste
 * prove dicono cosa deve succedere davvero:
 *  · ogni voce del «cosa manca» nasce da un dato vero, col numero vero;
 *  · i canoni sono quelli di Nicola, e ogni fascia comprende tutti e tre i servizi (dal 24/11 la
 *    scheda Google è dentro la gestione social);
 *  · la fascia consigliata segue i dati della vetrina;
 *  · un canone scritto male nelle impostazioni non arriva al cliente;
 *  · la fascia la sceglie il cliente, il canone lo rilegge il server.
 */

const VUOTA: DatiAttivita = { storeLogo: null, storeMedia: [], prodotti: [], socials: null };

const COMPLETA: DatiAttivita = {
  storeLogo: 'https://esempio.it/logo.png',
  storeMedia: [
    { type: 'image', url: 'https://esempio.it/1.jpg' },
    { type: 'image', url: 'https://esempio.it/2.jpg' },
    { type: 'image', url: 'https://esempio.it/3.jpg' },
    { type: 'video', url: 'https://esempio.it/v.mp4' },
  ],
  prodotti: [{ images: ['https://esempio.it/p1.jpg'] }, { images: ['https://esempio.it/p2.jpg'] }],
  socials: { instagram: 'barroma', website: 'https://barroma.it' },
};

const DI_LISTINO = leggiImpostazioniAgenzia({});
const ADESSO = new Date('2026-11-22T10:00:00Z');

describe('i tre abbonamenti sono quelli di Nicola (24/11/2026)', () => {
  it('Base 300 €, Business 500 €, Premium 999 € al mese', () => {
    expect(ABBONAMENTI).toEqual(['base', 'business', 'premium']);
    expect(DI_LISTINO.prezzi).toEqual({ base: 30000, business: 50000, premium: 99900 });
    expect(DI_LISTINO.nome).toBe(NOME_AGENZIA_DI_RISERVA);
    expect(NOME_AGENZIA_DI_RISERVA).toBe('MyCity'); // il preventivo lo firma MyCity (Nicola, 23/11)
    // 24/11: tutti i servizi li realizza SDG Agenzia, nominata una volta sola
    expect(FRASE_PARTNER).toBe('I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.');
    expect(SERVIZI_AGENZIA.every((id) => !('partner' in LISTINO[id]))).toBe(true);
    expect(SERVIZI_AGENZIA).not.toContain('logo' as never);
  });

  it('ogni fascia comprende tutti e tre i servizi, la vetrina e l assistenza, con parole diverse', () => {
    for (const s of SERVIZI_AGENZIA) {
      const testi = ABBONAMENTI.map((f) => FASCE[f].servizi[s]);
      expect(testi.every((t) => t.trim().length > 10), s).toBe(true);
      expect(new Set(testi).size, `${s}: le tre fasce devono dire cose diverse`).toBe(3);
    }
    expect(ABBONAMENTI.every((f) => FASCE[f].vetrina.length > 10 && FASCE[f].assistenza.length > 10)).toBe(true);
  });

  it('i canoni si scrivono come li legge il cliente', () => {
    expect(scriviCanone(30000)).toMatch(/^300,00\s€ al mese$/);
    expect(scriviCanone(99900)).toMatch(/^999,00\s€ al mese$/);
    expect(scriviCanone(null)).toBe('su richiesta');
  });
});

describe('cosa manca alla vetrina', () => {
  it('una vetrina vuota si vede proporre tutti i servizi, nell ordine del listino (quattro dal 24/11 sera)', () => {
    expect(cosaManca(VUOTA).map((v) => v.id)).toEqual(['foto_video', 'sito_web', 'social', 'analisi']);
  });

  it('una vetrina completa si vede proporre solo la gestione social, con dentro la scheda Google, e l analisi', () => {
    const voci = cosaManca(COMPLETA);
    expect(voci.map((v) => v.id)).toEqual(['social', 'analisi']);
    expect(voci[0].perche[0]).toContain('Instagram');
    expect(voci[0].perche[1]).toContain('Google');
  });

  it('foto e video elenca ogni cosa che manca, col numero vero dei prodotti senza foto', () => {
    const dati: DatiAttivita = {
      ...COMPLETA,
      storeMedia: [{ type: 'image', url: 'https://esempio.it/1.jpg' }],
      prodotti: [{ images: [] }, { images: null }, { images: [''] }, { images: ['https://esempio.it/ok.jpg'] }],
    };
    const voce = cosaManca(dati).find((v) => v.id === 'foto_video');
    expect(voce?.perche).toEqual([
      `La copertina ha 1 foto del locale: ne consigliamo almeno ${FOTO_LOCALE_CONSIGLIATE}.`,
      '3 prodotti sono senza foto, su 4 in catalogo.',
      'Nella vetrina non c’è nessun video.',
    ]);
  });

  it('un video non conta come foto, e una foto senza indirizzo non conta', () => {
    const dati: DatiAttivita = { ...COMPLETA, storeMedia: [{ type: 'video', url: 'https://esempio.it/v.mp4' }, { type: 'image', url: '' }] };
    expect(cosaManca(dati).find((v) => v.id === 'foto_video')?.perche).toEqual(['La copertina della vetrina non ha nessuna foto del locale.']);
  });

  it('il sito web manca solo se non c è un indirizzo scritto', () => {
    expect(cosaManca({ ...COMPLETA, socials: { website: '   ' } }).some((v) => v.id === 'sito_web')).toBe(true);
    expect(cosaManca({ ...COMPLETA, socials: { website: 'https://a.it' } }).some((v) => v.id === 'sito_web')).toBe(false);
  });
});

describe('il preventivo', () => {
  it('porta i canoni delle tre fasce e cosa manca, senza prezzi per servizio', () => {
    const p = costruisciPreventivo({ idAttivita: 'abc123-def', nomeAttivita: 'Bar Roma', tipoAttivita: 'bar', dati: VUOTA, impostazioni: DI_LISTINO, adesso: ADESSO });
    expect(p.prezzi).toEqual({ base: 30000, business: 50000, premium: 99900 });
    expect(p.righe.map((r) => r.id)).toEqual(['foto_video', 'sito_web', 'social', 'analisi']);
    expect(p.righe.some((r) => 'prezzo' in r)).toBe(false);
    expect(p.scelto).toBeNull();
  });

  it('consiglia il Business a chi deve rifare foto o sito, il Base a una vetrina in ordine, il Premium a un catalogo grande', () => {
    const imp = DI_LISTINO;
    const di = (dati: DatiAttivita) => costruisciPreventivo({ idAttivita: 'x', nomeAttivita: 'Bar', tipoAttivita: 'bar', dati, impostazioni: imp, adesso: ADESSO });
    expect(di(VUOTA).consigliato).toBe('business');
    expect(di(VUOTA).perche_consigliato).toContain('foto e video');
    expect(di(COMPLETA).consigliato).toBe('base');
    const grande = { ...COMPLETA, prodotti: Array.from({ length: PRODOTTI_PER_IL_PREMIUM }, () => ({ images: ['https://esempio.it/p.jpg'] })) };
    expect(di(grande).consigliato).toBe('premium');
    expect(di(grande).perche_consigliato).toContain(String(PRODOTTI_PER_IL_PREMIUM));
  });

  it('Nicola cambia un canone dalle impostazioni, senza rifare il sito', () => {
    const imp = leggiImpostazioniAgenzia({ nome: 'Studio Prova', abbonamenti: { base: 25000, premium: null }, prezzi: { social: 1 } });
    expect(imp.nome).toBe('Studio Prova');
    expect(imp.prezzi.base).toBe(25000);
    expect(imp.prezzi.premium).toBeNull(); // null scritto = su richiesta
    expect(imp.prezzi.business).toBe(50000); // non scritto = listino
    expect('social' in imp.prezzi).toBe(false); // la vecchia chiave «prezzi» si ignora
  });

  it('un canone scritto male diventa «su richiesta», non un prezzo sbagliato; lo 0 non è un prezzo', () => {
    const imp = leggiImpostazioniAgenzia({ abbonamenti: { base: '300', business: 12.5, premium: 0 } });
    expect(Object.values(imp.prezzi).every((v) => v === null)).toBe(true);
    expect(leggiImpostazioniAgenzia({ abbonamenti: { base: 99_999_999 } }).prezzi.base).toBeNull();
    const p = costruisciPreventivo({ idAttivita: 'x', nomeAttivita: 'Bar', tipoAttivita: 'bar', dati: VUOTA, impostazioni: imp, adesso: ADESSO });
    expect(ABBONAMENTI.map((f) => scriviCanone(p.prezzi[f])).join(' | ')).not.toMatch(/0,00/);
  });

  it('l esempio scritto nel commento della migrazione usa solo chiavi vere ed è il listino di Nicola', () => {
    const sql = readFileSync(join(process.cwd(), 'migrations/705_il_preventivo_ha_tre_abbonamenti.sql'), 'utf8');
    const commento = sql.match(/COMMENT ON COLUMN public\.site_settings\.agenzia IS\s*'([^']*)'/);
    expect(commento, 'commento della colonna agenzia non trovato').toBeTruthy();
    const esempio = JSON.parse(commento![1].match(/Esempio: (\{.*?\}\})\./)![1]) as { abbonamenti: Record<string, unknown> };
    expect(Object.keys(esempio.abbonamenti).every((k) => (ABBONAMENTI as readonly string[]).includes(k))).toBe(true);
    expect(leggiImpostazioniAgenzia(esempio).prezzi).toEqual(DI_LISTINO.prezzi);
  });

  it('il numero è lo stesso per tutta la giornata di Piacenza, anche dopo mezzanotte UTC', () => {
    // 23:30 UTC del 21 = 00:30 del 22 a Piacenza
    expect(giornoDiPiacenza(new Date('2026-11-21T23:30:00Z'))).toBe('2026-11-22');
    expect(numeroPreventivo('a1b2c3d4-e5f6', '2026-11-22')).toBe('P-20261122-A1B2C3');
  });

  it('l avviso a Nicola dice chi, quale abbonamento e a quanto, cosa manca e il telefono', () => {
    const p = costruisciPreventivo({
      idAttivita: 'a1b2c3d4', nomeAttivita: 'Bar Roma', tipoAttivita: 'bar',
      dati: VUOTA, impostazioni: DI_LISTINO, adesso: ADESSO, scelto: 'premium',
    });
    expect(testoAvvisoPreventivo(p, '3331234567')).toMatch(
      /^Bar Roma sceglie l'abbonamento Premium \(999,00\s€ al mese, il primo mese 499,50\s€\), preventivo P-20261122-A1B2C3\. Alla vetrina mancano: Foto e video, Sito web professionale, Gestione dei social e di Google Maps, Analisi del business\. Telefono: 3331234567\.$/,
    );
  });
});

describe('le condizioni e il pareggio (24/11/2026)', () => {
  it('nessun vincolo, 30 giorni di preavviso, primo mese a metà prezzo', () => {
    expect(CONDIZIONI).toEqual({ preavvisoGiorni: 30, primoMeseFrazione: 0.5 });
    expect(FRASE_CONDIZIONI).toBe('Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.');
    expect([30000, 50000, 99900].map(canonePrimoMese)).toEqual([15000, 25000, 49950]);
    expect(canonePrimoMese(null)).toBeNull();
  });

  it('il pareggio dice gli euro al giorno e quanti scontrini in più, arrotondati in su', () => {
    // bar, colazione da 3 €: 300 € → 10 €/giorno → 4 colazioni; 500 € → 16,67 → 6; 999 € → 33,30 → 12
    expect(SCONTRINO_DI_PARTENZA.bar).toEqual({ centesimi: 300, cosa: 'colazioni', una: 'colazione' });
    expect(pareggio(30000, 300)).toEqual({ alGiornoCentesimi: 1000, quanti: 4 });
    expect(pareggio(50000, 300)).toEqual({ alGiornoCentesimi: 1667, quanti: 6 });
    expect(pareggio(99900, 300)).toEqual({ alGiornoCentesimi: 3330, quanti: 12 });
    expect(pareggio(50000, 2500)).toEqual({ alGiornoCentesimi: 1667, quanti: 1 });
  });

  it('la frase del pareggio usa il singolare con 1 e i centesimi sotto i 10 € al giorno', () => {
    expect(frasePareggio({ alGiornoCentesimi: 1667, quanti: 6 }, 'bar')).toEqual({ alGiorno: '17 €', quanti: '6 colazioni' });
    expect(frasePareggio({ alGiornoCentesimi: 1667, quanti: 1 }, 'bar').quanti).toBe('1 colazione');
    expect(frasePareggio({ alGiornoCentesimi: 33, quanti: 1 }, 'ristorante').alGiorno).toMatch(/^0,33\s€$/);
  });

  it('senza canone o con uno scontrino non valido il pareggio non si scrive', () => {
    expect(pareggio(null, 300)).toBeNull();
    expect(pareggio(50000, 0)).toBeNull();
    expect(pareggio(50000, Number.NaN)).toBeNull();
  });

  it('un canone sotto i 10 € è quasi certamente scritto in euro: diventa «su richiesta» (collaudo del 24/11)', () => {
    const imp = leggiImpostazioniAgenzia({ abbonamenti: { base: 300, business: 999, premium: 1000 } });
    expect(imp.prezzi).toEqual({ base: null, business: null, premium: 1000 });
  });
});

describe('cosa ci guadagni: solo frasi vere', () => {
  it('parte dai fatti della vetrina, senza numeri di piattaforma', () => {
    const g = cosaCiGuadagni(cosaManca(VUOTA), 'bar');
    expect(g.oggi).toEqual([
      'Chi apre la tua vetrina su MyCity oggi trova questo: la copertina della vetrina non ha nessuna foto del locale.',
      'Non hai ancora un sito tutto tuo, con il tuo nome.',
      'Chi cerca «bar vicino a me» vede prima le schede Google complete di orari e foto: se la tua non lo è, vede gli altri.',
    ]);
    // nessun «X volte», nessuna percentuale: al 24/11 non ci sono dati per dirlo
    expect([...g.oggi, g.conNoi].join(' ')).not.toMatch(/\d+\s*(volte|%)/);
  });

  it('non dice «non ti trova nessuno» a chi ha i social, e non promette «ogni mese» a tutte le fasce (collaudo, 24/11)', () => {
    const g = cosaCiGuadagni(cosaManca({ ...VUOTA, socials: { instagram: 'barroma', facebook: 'barroma' } }), 'bar');
    expect([...g.oggi, g.conNoi].join(' ')).not.toMatch(/non trova una pagina|ogni mese/);
  });

  it('a una vetrina completa non dice che manca qualcosa', () => {
    const g = cosaCiGuadagni(cosaManca(COMPLETA), 'bar');
    expect(g.oggi.join(' ')).not.toMatch(/foto del locale|pagina tua/);
  });
});

