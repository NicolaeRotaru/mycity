import { describe, it, expect } from 'vitest';
import {
  FOTO_LOCALE_CONSIGLIATE,
  LISTINO,
  NOME_AGENZIA_DI_RISERVA,
  costruisciPreventivo,
  cosaManca,
  giornoDiPiacenza,
  leggiImpostazioniAgenzia,
  numeroPreventivo,
  testoAvvisoPreventivo,
  type DatiAttivita,
} from '@/lib/agenzia/preventivo';
import { scriviPrezzo, scriviTotale } from '@/components/seller/preventivo-agenzia';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SERVIZI_AGENZIA } from '@/lib/agenzia/preventivo';

/**
 * 22/11/2026 — Nicola: la dashboard del cliente mostra «il preventivo di quello
 * che gli manca», già pronto. Listino di Nicola, stesso giorno: sito 500 €,
 * social 300 € al mese, foto e video da 50 a 300 € al mese; il logo non ha
 * prezzo («su richiesta»). Queste prove dicono cosa deve succedere davvero:
 *  · ogni voce nasce da un dato vero, col numero vero («3 prodotti sono senza foto»);
 *  · una vetrina completa non si vede proporre logo, foto, video o sito;
 *  · i prezzi sono quelli di Nicola, e i totali tengono separati «una volta» e «al mese»;
 *  · un prezzo scritto male nelle impostazioni non arriva al cliente;
 *  · quando il cliente toglie una voce, il server non la rimette, e non ne aggiunge
 *    una che non manca.
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

describe('il listino è quello di Nicola (22/11/2026)', () => {
  it('sito 500 € una volta, social 300 € al mese, foto e video da 50 a 300 € al mese, logo su richiesta', () => {
    expect(DI_LISTINO.prezzi.sito_web).toEqual({ da: 50000, a: 50000 });
    expect(LISTINO.sito_web.cadenza).toBe('una_tantum');
    expect(DI_LISTINO.prezzi.social).toEqual({ da: 30000, a: 30000 });
    expect(LISTINO.social.cadenza).toBe('mese');
    expect(DI_LISTINO.prezzi.foto_video).toEqual({ da: 5000, a: 30000 });
    expect(LISTINO.foto_video.cadenza).toBe('mese');
    expect(DI_LISTINO.prezzi.logo).toBeNull();
    expect(DI_LISTINO.nome).toBe(NOME_AGENZIA_DI_RISERVA);
    expect(NOME_AGENZIA_DI_RISERVA).toBe('MyCity'); // il preventivo lo firma MyCity (Nicola, 23/11)
    expect(LISTINO.foto_video.partner).toBe('scattiDG'); // foto e video li fa il partner scattiDG
  });

  it('i prezzi si scrivono come li legge il cliente', () => {
    expect(scriviPrezzo({ da: 5000, a: 30000 }, 'mese')).toMatch(/^da 50,00\s€ a 300,00\s€ al mese$/);
    expect(scriviPrezzo({ da: 30000, a: 30000 }, 'mese')).toMatch(/^300,00\s€ al mese$/);
    expect(scriviPrezzo(null, 'una_tantum')).toBe('su richiesta');
  });
});

describe('cosa manca alla vetrina', () => {
  it('una vetrina vuota si vede proporre tutti e quattro i servizi, nell ordine del listino', () => {
    expect(cosaManca(VUOTA).map((v) => v.id)).toEqual(['logo', 'foto_video', 'social', 'sito_web']);
  });

  it('una vetrina completa si vede proporre solo la gestione dei social', () => {
    const voci = cosaManca(COMPLETA);
    expect(voci.map((v) => v.id)).toEqual(['social']);
    expect(voci[0].perche[0]).toContain('Instagram');
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
  it('i totali tengono separati «una volta» e «al mese», e dicono cosa è su richiesta', () => {
    const p = costruisciPreventivo({ idAttivita: 'abc123-def', nomeAttivita: 'Bar Roma', tipoAttivita: 'bar', dati: VUOTA, impostazioni: DI_LISTINO, adesso: ADESSO });
    expect(p.totaleUnaTantum).toEqual({ da: 50000, a: 50000, suRichiesta: ['Logo e grafica'] });
    expect(p.totaleMensile).toEqual({ da: 35000, a: 60000, suRichiesta: [] });
    expect(scriviTotale(p.totaleUnaTantum!, 'una_tantum')).toMatch(/^500,00\s€ \+ Logo e grafica su richiesta$/);
    expect(scriviTotale(p.totaleMensile!, 'mese')).toMatch(/^da 350,00\s€ a 600,00\s€ al mese$/);
  });

  it('Nicola cambia un prezzo dalle impostazioni, senza rifare il sito', () => {
    const imp = leggiImpostazioniAgenzia({ nome: 'Studio Prova', prezzi: { logo: 15000, social: { da: 20000, a: 30000 }, sito_web: null } });
    expect(imp.nome).toBe('Studio Prova');
    expect(imp.prezzi.logo).toEqual({ da: 15000, a: 15000 });
    expect(imp.prezzi.social).toEqual({ da: 20000, a: 30000 });
    expect(imp.prezzi.sito_web).toBeNull(); // null scritto = su richiesta
    expect(imp.prezzi.foto_video).toEqual({ da: 5000, a: 30000 }); // non scritto = listino
  });

  it('un prezzo scritto male diventa «su richiesta», non un prezzo sbagliato', () => {
    const imp = leggiImpostazioniAgenzia({ prezzi: { logo: -5, social: '300', sito_web: 12.5, foto_video: { da: 30000, a: 5000 } } });
    expect(imp.prezzi.logo).toBeNull();
    expect(imp.prezzi.social).toBeNull();
    expect(imp.prezzi.sito_web).toBeNull();
    expect(imp.prezzi.foto_video).toBeNull();
    expect(leggiImpostazioniAgenzia({ prezzi: { sito_web: 99_999_999 } }).prezzi.sito_web).toBeNull();
  });

  it('lo 0 non è un prezzo: il cliente non legge mai «0,00 €» (collaudo del 23/11)', () => {
    const imp = leggiImpostazioniAgenzia({ prezzi: { logo: 0, social: 0, sito_web: 0, foto_video: { da: 0, a: 30000 } } });
    expect(Object.values(imp.prezzi).every((v) => v === null)).toBe(true);
    const p = costruisciPreventivo({ idAttivita: 'x', nomeAttivita: 'Bar', tipoAttivita: 'bar', dati: VUOTA, impostazioni: imp, adesso: ADESSO });
    const testi = [
      ...p.righe.map((r) => scriviPrezzo(r.prezzo, r.cadenza)),
      scriviTotale(p.totaleUnaTantum!, 'una_tantum'),
      scriviTotale(p.totaleMensile!, 'mese'),
    ];
    expect(testi.join(' | ')).not.toMatch(/0,00/);
  });

  it('l esempio scritto nel commento della migrazione usa solo chiavi vere e non produce prezzi a zero', () => {
    const sql = readFileSync(join(process.cwd(), 'migrations/703_ogni_attivita_puo_iscriversi_e_ha_il_suo_preventivo.sql'), 'utf8');
    const commento = sql.match(/COMMENT ON COLUMN public\.site_settings\.agenzia IS\s*'([^']*)'/);
    expect(commento, 'commento della colonna agenzia non trovato').toBeTruthy();
    const esempio = JSON.parse(commento![1].match(/Esempio: (\{.*?\}\})\./)![1]) as { prezzi: Record<string, unknown> };
    expect(Object.keys(esempio.prezzi).every((k) => (SERVIZI_AGENZIA as readonly string[]).includes(k))).toBe(true);
    const imp = leggiImpostazioniAgenzia(esempio);
    expect(imp.prezzi).toEqual(leggiImpostazioniAgenzia({}).prezzi); // l'esempio è il listino di Nicola
  });

  it('le scelte del cliente tolgono voci ma non ne aggiungono una che non manca', () => {
    const p = costruisciPreventivo({
      idAttivita: 'x', nomeAttivita: 'Bar', tipoAttivita: 'bar', dati: COMPLETA, impostazioni: DI_LISTINO, adesso: ADESSO,
      scelte: ['logo', 'social'],
    });
    expect(p.righe.map((r) => r.id)).toEqual(['social']); // il logo c'è già: non entra anche se scelto
    expect(p.giaAPosto).toContain('logo');
    expect(p.totaleUnaTantum).toBeNull();
  });

  it('il numero è lo stesso per tutta la giornata di Piacenza, anche dopo mezzanotte UTC', () => {
    // 23:30 UTC del 21 = 00:30 del 22 a Piacenza
    expect(giornoDiPiacenza(new Date('2026-11-21T23:30:00Z'))).toBe('2026-11-22');
    expect(numeroPreventivo('a1b2c3d4-e5f6', '2026-11-22')).toBe('P-20261122-A1B2C3');
  });

  it('l avviso a Nicola dice chi, quale preventivo, quali voci e il telefono', () => {
    const p = costruisciPreventivo({
      idAttivita: 'a1b2c3d4', nomeAttivita: 'Bar Roma', tipoAttivita: 'bar',
      dati: VUOTA, impostazioni: DI_LISTINO, adesso: ADESSO, scelte: ['foto_video', 'sito_web'],
    });
    expect(testoAvvisoPreventivo(p, '3331234567')).toMatch(
      /^Bar Roma vuole il preventivo P-20261122-A1B2C3: Foto e video \(scattiDG\), Sito web professionale\. Totale: una volta 500,00\s€; ogni mese da 50,00\s€ a 300,00\s€ al mese\. Telefono: 3331234567\.$/,
    );
  });
});
