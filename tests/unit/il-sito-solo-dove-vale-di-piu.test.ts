/**
 * 25/11/2026 — IL SITO SI OFFRE SOLO DOVE VALE DI PIÙ (A) · L'ANALISI DEL BUSINESS CAMBIA LE PROPOSTE (B).
 *
 * Nicola, «ok sito» (25/11 19:15, riportato dall'AD), la tabella dei livelli del sito:
 *  · nessun sito → bozza dal Base;
 *  · semplice → rifatto dal Base;
 *  · medio → tenuto e collegato nel Base, rifatto dal Business;
 *  · pregio → tenuto e collegato nel Base e nel Business, rifatto solo nel Premium, con quello che
 *    miglioriamo scritto dall'AD (senza, non si rifà mai);
 *  · giudizio mancante → vale «medio»: mai rifare dal Base un sito che non abbiamo guardato;
 *  · la bozza va anche a chi ha un sito, se almeno un abbonamento lo rifà.
 * B: le opportunità e le prime mosse dell'analisi del business che un nostro servizio copre diventano
 * proposte, con la loro fonte; l'abbonamento consigliato tiene conto del sito e dell'analisi.
 */
import { describe, it, expect } from 'vitest';
import { cosaInFascia, leggiGiudizioSito, offertaSuMisura, sitoDaRifareInQualcheFascia, type DatiPerLOfferta, type GiudizioSito } from '@/lib/agenzia/offerta-su-misura';
import { riassumiPageSpeed, analisiAziendale } from '@/lib/agenzia/analisi';
import { SchedaInArrivo } from '@/lib/agenzia/scheda-cliente';
import { consigliataDallOfferta } from '@/lib/agenzia/preventivo';
import { aspettaLaBozza } from '@/lib/agenzia/bozza-sito-ad';

const ID = '0de1905e-7000-4000-8000-000000000003';
// Un sito che Google trova lento: c'è qualcosa da rifare.
const LENTO = riassumiPageSpeed(
  { lighthouseResult: { categories: { performance: { score: 0.4 }, seo: { score: 0.95 }, accessibility: { score: 0.95 } }, audits: {} } },
  'https://www.esempio.it/', new Date('2026-11-25T09:00:00Z'),
);
// Un sito che Google trova a posto.
const VELOCE = riassumiPageSpeed(
  { lighthouseResult: { categories: { performance: { score: 0.95 }, seo: { score: 0.95 }, accessibility: { score: 0.95 } }, audits: {} } },
  'https://www.esempio.it/', new Date('2026-11-25T09:00:00Z'),
);
const conSito = (sito: DatiPerLOfferta['sito'], giudizioSito: GiudizioSito | null): DatiPerLOfferta => ({
  nome: 'Esempio', tipo: 'ristorante', sito, giudizioSito,
  dati: { storeLogo: null, storeMedia: [], prodotti: [], socials: { website: 'https://www.esempio.it' } },
});
const sitoDi = (d: DatiPerLOfferta) => offertaSuMisura(d).proposte.find((x) => x.servizio === 'sito_web' && x.id.startsWith('sito-'))!;
const g = (x: Partial<GiudizioSito>): GiudizioSito => leggiGiudizioSito(x)!;

describe('il contratto del giudizio del sito', () => {
  it('livello, funzioni da un elenco chiuso, migliorie in una frase senza prezzi', () => {
    expect(leggiGiudizioSito({ livello: 'pregio', funzioni: ['prenotazioni', 'negozio_online', 'teletrasporto'], migliorie: 'Le prenotazioni dal telefono e il menu tradotto in inglese' })).toEqual({
      aspetto: null, pagine: null, nota: null, livello: 'pregio', funzioni: ['prenotazioni', 'negozio_online'], migliorie: 'Le prenotazioni dal telefono e il menu tradotto in inglese',
    });
    expect(leggiGiudizioSito({ livello: 'bellissimo' })).toBeNull();
    expect(leggiGiudizioSito({ livello: 'medio', migliorie: 'Costa 3.000 € rifarlo' })!.migliorie).toBeNull();
    // il giudizio di prima (aspetto, pagine, nota) si legge ancora
    expect(leggiGiudizioSito({ aspetto: 'datato', pagine: 'una' })!.livello).toBeNull();
  });
});

describe('A · la tabella dei livelli del sito', () => {
  it('nessun sito: la bozza dal Base, come oggi', () => {
    const o = offertaSuMisura({ ...conSito(null, null), dati: { storeLogo: null, storeMedia: [], prodotti: [], socials: null } });
    expect(o.proposte.find((x) => x.id === 'sito-nuovo')!.daFascia).toBe('base');
  });

  it('semplice: rifatto dal Base', () => {
    const x = sitoDi(conSito(VELOCE, g({ livello: 'semplice' })));
    expect(x.id).toBe('sito-rifatto');
    expect(cosaInFascia(x, 'base')).toMatch(/^Rifacciamo/);
  });

  it('medio con qualcosa da rifare: tenuto e collegato nel Base, rifatto dal Business', () => {
    const x = sitoDi(conSito(LENTO, g({ livello: 'medio' })));
    expect(cosaInFascia(x, 'base')).toMatch(/^Teniamo|^Colleghiamo/);
    expect(cosaInFascia(x, 'business')).toMatch(/^Rifacciamo/);
    expect(cosaInFascia(x, 'premium')).toMatch(/^Rifacciamo/);
  });

  it('giudizio mancante vale medio: mai rifatto dal Base un sito che non abbiamo guardato', () => {
    const x = sitoDi(conSito(LENTO, null));
    expect(cosaInFascia(x, 'base')).not.toMatch(/Rifacciamo/);
    expect(cosaInFascia(x, 'business')).toMatch(/^Rifacciamo/);
    // anche col giudizio di prima, senza livello
    expect(cosaInFascia(sitoDi(conSito(LENTO, g({ aspetto: 'datato' }))), 'base')).not.toMatch(/Rifacciamo/);
  });

  it('pregio con migliorie: tenuto nel Base e nel Business, rifatto solo nel Premium con le migliorie dell AD', () => {
    const x = sitoDi(conSito(LENTO, g({ livello: 'pregio', migliorie: 'Le prenotazioni dal telefono e il menu in inglese' })));
    expect(cosaInFascia(x, 'base')).not.toMatch(/Rifacciamo/);
    expect(cosaInFascia(x, 'business')).not.toMatch(/Rifacciamo/);
    expect(cosaInFascia(x, 'premium')).toMatch(/^Rifacciamo/);
    expect(cosaInFascia(x, 'premium')).toContain('le prenotazioni dal telefono e il menu in inglese');
  });

  it('pregio senza migliorie: non si rifà in nessuna fascia', () => {
    const x = sitoDi(conSito(LENTO, g({ livello: 'pregio' })));
    expect(x.id).toBe('sito-valorizzato');
    for (const f of ['base', 'business', 'premium'] as const) expect(cosaInFascia(x, f)).not.toMatch(/Rifacciamo/);
  });

  // 25/11/2026 sera, dal collaudo: la tabella non dipende da Google. Un medio a posto per Google si rifà comunque dal Business.
  it('medio e a posto per Google: tenuto nel Base, rifatto dal Business', () => {
    const x = sitoDi(conSito(VELOCE, g({ livello: 'medio' })));
    expect(x.id).toBe('sito-rifatto');
    expect(cosaInFascia(x, 'base')).toMatch(/^Colleghiamo/);
  });

  it('la bozza va a chi ha un sito solo se almeno un abbonamento lo rifà', () => {
    expect(sitoDaRifareInQualcheFascia(g({ livello: 'pregio' }))).toBe(false);
    expect(sitoDaRifareInQualcheFascia(null)).toBe(true);
    expect(sitoDaRifareInQualcheFascia(g({ livello: 'medio' }))).toBe(true);
    expect(sitoDaRifareInQualcheFascia(g({ livello: 'semplice' }))).toBe(true);
    const negozio = { id: ID, ruolo: 'seller', sito: 'https://www.esempio.it', bozzaIl: null, schedaIl: null };
    expect(aspettaLaBozza({ ...negozio, sitoDaRifare: true })).toEqual({ aspetta: true, perche: 'sito_da_rifare' });
    expect(aspettaLaBozza({ ...negozio, sitoDaRifare: false })).toEqual({ aspetta: false });
    expect(aspettaLaBozza(negozio)).toEqual({ aspetta: false });
  });

  it('la fascia consigliata sale fin dove il sito si rifà', () => {
    const base = { id: 'base' as const, perche: 'La tua vetrina è già in ordine.' };
    const medio = consigliataDallOfferta(base, offertaSuMisura(conSito(LENTO, null)));
    expect(medio.id).toBe('business');
    expect(medio.perche).toMatch(/sito/);
    const pregio = consigliataDallOfferta(base, offertaSuMisura(conSito(LENTO, g({ livello: 'pregio', migliorie: 'Le prenotazioni dal telefono e il menu in inglese' }))));
    expect(pregio.id).toBe('premium');
    // non scende mai: un catalogo grande resta sul Premium
    expect(consigliataDallOfferta({ id: 'premium', perche: 'Tanti prodotti.' }, offertaSuMisura(conSito(LENTO, null))).id).toBe('premium');
  });
});

describe('B · le opportunità dell analisi diventano proposte', () => {
  const scheda = SchedaInArrivo.parse({
    tipo: 'scheda-cliente', id_attivita: ID, campi: {},
    analisi: {
      business: {
        situazione: [{ testo: 'Ristorante aperto da vent’anni nel centro storico', fonte: 'https://www.esempio.it/chi-siamo' }],
        // 26/11/2026 — Fonti che non sono pagine di TripAdvisor o Google Maps: quelle non si citano più (parere legale).
        opportunita: [
          { testo: 'Molte ricerche di pranzo veloce in zona, e il menu del pranzo non è in rete', fonte: 'https://www.ilpiacenza.it/pranzo', servizio: 'social', proposta: 'Mettiamo il menu del pranzo su Google e su Instagram ogni settimana' },
          { testo: 'Un concorrente vicino ha chiuso a settembre', fonte: 'https://www.ilpiacenza.it/y' },
          { testo: 'Nessuna foto dei piatti nelle recensioni più lette', fonte: 'https://www.tripadvisor.it/z', servizio: 'foto_video', proposta: 'Costa solo 100 € fotografare i piatti' },
        ],
        prime_mosse: [{ testo: 'Raccogliere le prenotazioni dal sito, oggi solo per telefono', fonte: 'https://www.esempio.it/', servizio: 'sito_web', proposta: 'Mettiamo il pulsante «Prenota» sul tuo sito' }],
      },
    },
  });
  const analisi = analisiAziendale(scheda);

  it('solo quelle con un servizio e una proposta pulita, con la fonte', () => {
    const o = offertaSuMisura({ ...conSito(VELOCE, g({ livello: 'medio' })), analisiAziendale: analisi });
    const dall = o.proposte.filter((x) => x.id.startsWith('analisi-opp-'));
    expect(dall.map((x) => [x.servizio, x.cosa])).toEqual([
      ['social', 'Mettiamo il menu del pranzo su Google e su Instagram ogni settimana'],
      ['sito_web', 'Mettiamo il pulsante «Prenota» sul tuo sito'],
    ]);
    expect(dall[0].perche).toContain('menu del pranzo non è in rete');
    expect(dall[0].fonte).toBe('ilpiacenza.it');
    expect(dall.every((x) => !x.generica)).toBe(true);
    // senza analisi, nessuna
    expect(offertaSuMisura(conSito(VELOCE, g({ livello: 'medio' }))).proposte.some((x) => x.id.startsWith('analisi-opp-'))).toBe(false);
  });

  it('con opportunità da seguire, il consiglio non resta sul Base', () => {
    // un sito di pregio senza migliorie non sposta il consiglio: lo sposta l'analisi
    const o = offertaSuMisura({ ...conSito(VELOCE, g({ livello: 'pregio' })), analisiAziendale: analisi });
    const c = consigliataDallOfferta({ id: 'base', perche: 'La tua vetrina è già in ordine.' }, o);
    expect(c.id).toBe('business');
    expect(c.perche).toMatch(/opportunit/);
  });
});
