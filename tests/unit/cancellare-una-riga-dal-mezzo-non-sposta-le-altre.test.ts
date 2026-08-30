/**
 * 27/8/2026 (R101) — NEL COSTRUTTORE DELLA HOME LE RIGHE ERANO IDENTIFICATE DALLA POSIZIONE.
 *
 * Gli elenchi modificabili — i «Vantaggi» e le «Immagini» della galleria — davano a React
 * `key={i}`, cioè la posizione. Ma il cestino cancella dal mezzo: cancellata la seconda di quattro,
 * la terza diventa la seconda, e per React è «la stessa riga con un contenuto diverso». I campi di
 * testo si riallineano da soli (il valore arriva da fuori), ma lo stato che i sotto-componenti
 * tengono dentro di sé no: `ImageUrlField` si porta dietro il proprio «Caricamento…», che finisce
 * agganciato alla riga sbagliata.
 *
 * Chi costruisce la home vede l'avanzamento del caricamento su un'immagine che non è quella, o
 * un'anteprima che non corrisponde alla riga. Il danno è contenuto — è un pannello interno — ma è
 * esattamente la classe di errore che porta a pubblicare in home l'immagine sbagliata.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { chiaveDiRiga, conChiaveEreditata } from '@/lib/liste/chiave-di-riga';

type Riga = { title: string; desc: string };
const elenco = (): Riga[] => [
  { title: 'Uno', desc: 'a' },
  { title: 'Due', desc: 'b' },
  { title: 'Tre', desc: 'c' },
  { title: 'Quattro', desc: 'd' },
];

describe("l'identità di una riga", () => {
  it('ogni riga ha la sua, e non se la scambia con nessuno', () => {
    const righe = elenco();
    const chiavi = righe.map(chiaveDiRiga);
    expect(new Set(chiavi).size).toBe(4);
  });

  it('resta la stessa a ogni disegno: non è un numero nuovo ogni volta', () => {
    const righe = elenco();
    expect(righe.map(chiaveDiRiga)).toEqual(righe.map(chiaveDiRiga));
  });

  it('cancellando la seconda di quattro, le altre tre restano loro stesse', () => {
    const righe = elenco();
    const prima = righe.map(chiaveDiRiga);

    const dopo = righe.filter((_, k) => k !== 1);

    expect(dopo.map(chiaveDiRiga), 'la terza riga eredita l\'identità della seconda: e con essa il suo «Caricamento…»')
      .toEqual([prima[0], prima[2], prima[3]]);
  });

  it('modificare una riga non la trasforma in una riga nuova', () => {
    // Ogni lettera battuta crea un oggetto nuovo: se cambiasse anche la chiave, il campo verrebbe
    // smontato e rimontato a ogni tasto, e il cursore uscirebbe da solo.
    const righe = elenco();
    const chiavePrima = chiaveDiRiga(righe[1]);

    const modificata = conChiaveEreditata(righe[1], { ...righe[1], title: 'Due bis' });

    expect(chiaveDiRiga(modificata)).toBe(chiavePrima);
  });

  it('una riga aggiunta in fondo ha un identità sua, mai quella di una cancellata', () => {
    const righe = elenco();
    const chiavi = righe.map(chiaveDiRiga);
    const nuova = { title: '', desc: '' };
    expect(chiavi).not.toContain(chiaveDiRiga(nuova));
  });
});

describe('il costruttore della home', () => {
  const src = readFileSync('components/admin/home/HomeSectionConfigForm.tsx', 'utf8');

  it('non identifica più le righe modificabili con la loro posizione', () => {
    // Controllo di struttura (i componenti React non si montano dentro una prova, qui). Restano
    // ammesse le `key={i}` sugli elenchi che nessuno può modificare — quelli sì che non si spostano.
    const righeConCestino = src.split('\n').filter((r) => r.includes('key={i}'));
    expect(righeConCestino, 'la posizione è tornata a fare da identità su un elenco che si può modificare').toEqual([]);
    expect(src).toContain('chiaveDiRiga');
  });
});
