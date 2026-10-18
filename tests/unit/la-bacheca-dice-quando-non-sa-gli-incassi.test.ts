import { describe, it, expect } from 'vitest';
import { riquadroDegliIncassi } from '@/lib/rider/incasso-alla-consegna';

/**
 * 16/10/2026 — «NESSUN INCASSO» E «NON LO SO» ERANO LA STESSA SCHERMATA.
 *
 * Martedi' sera il fattorino ha chiuso due consegne in contanti col codice
 * senza dichiarare l'incasso. Apre la bacheca mentre la lettura degli incassi
 * da confermare risponde 500. La pagina prendeva solo il dato, il dato restava
 * vuoto, e il riquadro non compariva: nessun messaggio. Lui chiudeva la
 * giornata convinto di non avere niente in sospeso, e la rimessa della sera
 * saltava quegli ordini.
 *
 * Qui si esegue la regola che decide cosa mostra il riquadro, con le letture
 * come le consegna React Query.
 */

type Incasso = { id: string };
const DUE: Incasso[] = [{ id: 'a' }, { id: 'b' }];

describe('cosa mostra il riquadro degli incassi da confermare', () => {
  it('lettura fallita, nessun dato: «non lo so», non «nessun incasso»', () => {
    const r = riquadroDegliIncassi<Incasso>({ isPending: false, isError: true, error: new Error('500') });
    expect(r.stato).toBe('non-so');
    expect(r.incassi).toEqual([]);
  });

  it('basta la bandierina d errore, anche senza l oggetto errore', () => {
    expect(riquadroDegliIncassi<Incasso>({ isPending: false, isError: true }).stato).toBe('non-so');
  });

  it('rilettura fallita con l ultimo elenco in mano: «non lo so», ma l elenco resta', () => {
    const r = riquadroDegliIncassi<Incasso>({ isPending: false, isError: true, data: DUE });
    expect(r.stato).toBe('non-so');
    expect(r.incassi.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('rilettura fallita su un elenco che era vuoto: resta «non lo so»', () => {
    expect(riquadroDegliIncassi<Incasso>({ isPending: false, isError: true, data: [] }).stato).toBe('non-so');
  });

  it('letto e vuoto: «nessuno», e il riquadro non compare', () => {
    const r = riquadroDegliIncassi<Incasso>({ isPending: false, isError: false, data: [] });
    expect(r).toEqual({ stato: 'nessuno', incassi: [] });
  });

  it('letto con consegne da confermare: l elenco', () => {
    const r = riquadroDegliIncassi<Incasso>({ isPending: false, isError: false, data: DUE });
    expect(r.stato).toBe('elenco');
    expect(r.incassi).toHaveLength(2);
  });

  it('la prima lettura in corso non e «nessun incasso» e non e un guasto', () => {
    expect(riquadroDegliIncassi<Incasso>({ isPending: true }).stato).toBe('in-lettura');
    expect(riquadroDegliIncassi<Incasso>({ isLoading: true }).stato).toBe('in-lettura');
  });

  it('un dato che non e un elenco non e un elenco vuoto', () => {
    expect(riquadroDegliIncassi<Incasso>({ isPending: false, isError: false, data: { incassi: DUE } }).stato).toBe('non-so');
  });

  it('non tocca l elenco che riceve', () => {
    const elenco = [...DUE];
    const r = riquadroDegliIncassi<Incasso>({ isPending: false, data: elenco });
    r.incassi.pop();
    expect(elenco).toHaveLength(2);
  });
});
