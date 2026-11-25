import { describe, it, expect } from 'vitest';
import { offertaSuMisura, leggiGiudizioSito } from '@/lib/agenzia/offerta-su-misura';
import { cosaManca } from '@/lib/agenzia/preventivo';
import type { RisultatoSito } from '@/lib/agenzia/analisi';

/**
 * 25/11/2026 — IL SITO CHE HA GIÀ ENTRA NEL PREVENTIVO.
 *
 * Nicola: «aggiungi anche google pagespeed, così se il sito c'è […] il preventivo si basa sul suo sito, ed
 * in base alla complessità/bellezza del sito deve già esporre in base all'abbonamento quale valore aggiunto
 * può apportare». Queste prove diventano rosse se il preventivo dice «non hai un sito» a chi ce l'ha, se un
 * sito già buono viene proposto da rifare, se uno lento o datato non viene proposto da rifare, o se il
 * giudizio dell'AD fa passare un prezzo.
 */

const sito = (v: Partial<RisultatoSito>): RisultatoSito =>
  ({
    url: 'https://www.esempio.it/',
    fatta_il: '2026-11-25T10:00:00.000Z',
    velocita: 95,
    seo: 92,
    accessibilita: 91,
    secondiPerVedere: 1.2,
    daSistemare: [],
    ...v,
  }) as RisultatoSito;

const base = { nome: 'Bar Prova', tipo: 'bar' as const, dati: { storeLogo: null, storeMedia: [], prodotti: [], socials: { website: 'https://www.esempio.it/' } } };
const voceSito = (o: ReturnType<typeof offertaSuMisura>) => o.proposte.find((p) => p.servizio === 'sito_web' && (p.id === 'sito-rifatto' || p.id === 'sito-valorizzato'));

describe('il sito che ha già, nell’offerta', () => {
  it('un sito buono e curato non si rifà: si tiene e cresce, con un valore diverso per abbonamento', () => {
    const v = voceSito(offertaSuMisura({ ...base, sito: sito({}), giudizioSito: { aspetto: 'curato', pagine: 'poche', nota: null } }));
    expect(v?.id).toBe('sito-valorizzato');
    expect(v?.perche).toMatch(/95 su 100/);
    const testi = [v?.perFascia?.base, v?.perFascia?.business, v?.perFascia?.premium];
    expect(new Set(testi).size).toBe(3);
    expect(v?.perFascia?.premium).toMatch(/ogni mese/);
  });

  it('un sito lento si rifà, e il perché dice il voto di Google', () => {
    const v = voceSito(offertaSuMisura({ ...base, sito: sito({ velocita: 34, secondiPerVedere: 6.1 }) }));
    expect(v?.id).toBe('sito-rifatto');
    expect(v?.perche).toMatch(/34 su 100/);
  });

  it('un sito veloce ma datato a vederlo si rifà, e lo dice', () => {
    const v = voceSito(offertaSuMisura({ ...base, sito: sito({}), giudizioSito: { aspetto: 'datato', pagine: 'una', nota: 'Foto piccole e testi del 2015' } }));
    expect(v?.id).toBe('sito-rifatto');
    expect(v?.perche).toMatch(/datato/);
    expect(v?.perche).toMatch(/Foto piccole/);
  });

  // 25/11/2026 — Dal Base si rifà solo il sito «semplice» (Nicola, «ok sito»): lib/agenzia/offerta-su-misura.ts.
  it('con tante pagine il Base rifà la pagina principale, non promette tutto il sito', () => {
    const v = voceSito(offertaSuMisura({ ...base, sito: sito({ velocita: 40 }), giudizioSito: { aspetto: null, pagine: 'molte', nota: null, livello: 'semplice' } }));
    expect(v?.perFascia?.base).toMatch(/pagina principale/);
  });

  it('senza la misura di Google non si inventa niente sul sito', () => {
    expect(voceSito(offertaSuMisura({ ...base, sito: null }))).toBeUndefined();
  });
});

describe('il giudizio dell’AD sul sito', () => {
  it('tiene solo i valori dell’elenco e scarta una nota con un prezzo', () => {
    expect(leggiGiudizioSito({ aspetto: 'bellissimo', pagine: 'molte', nota: 'Rifarlo costa 500 €' })).toEqual({ aspetto: null, pagine: 'molte', nota: null, livello: null, funzioni: [], migliorie: null });
    expect(leggiGiudizioSito({ aspetto: 'curato' })).toEqual({ aspetto: 'curato', pagine: null, nota: null, livello: null, funzioni: [], migliorie: null });
    expect(leggiGiudizioSito('curato')).toBeNull();
    expect(leggiGiudizioSito({})).toBeNull();
  });
});

describe('cosa ti serve: il sito', () => {
  it('a chi ha un sito misurato dice com’è, non «non hai un sito»', () => {
    const voci = cosaManca({ storeLogo: 'x', storeMedia: [], prodotti: [], socials: { website: 'https://www.esempio.it/' }, sitoOggi: ['Il tuo sito c’è, e Google l’ha misurato:', 'Velocità dal telefono: 95 su 100. Si apre veloce.'] });
    const s = voci.find((v) => v.id === 'sito_web');
    expect(s?.perche.join(' ')).toMatch(/95 su 100/);
    expect(s?.perche.join(' ')).not.toMatch(/non ha ancora un sito/);
  });

  it('a chi non ha un sito dice ancora che non ce l’ha', () => {
    const voci = cosaManca({ storeLogo: 'x', storeMedia: [], prodotti: [], socials: {} });
    expect(voci.find((v) => v.id === 'sito_web')?.perche.join(' ')).toMatch(/non ha ancora un sito/);
  });
});
