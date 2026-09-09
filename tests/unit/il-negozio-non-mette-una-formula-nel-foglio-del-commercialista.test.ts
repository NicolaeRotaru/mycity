import { describe, it, expect } from 'vitest';
import { campoCsvSicuro, componiCsv, contenutoFileCsv, BOM_EXCEL } from '@/lib/csv-sicuro';
import {
  contenutoCsvOrdini,
  INTESTAZIONI_CSV_ORDINI,
  type OrdineDaEsportare,
  type RaccoltaOrdini,
} from '@/lib/ordini/esporta-ordini';

/**
 * UN NEGOZIO NON FA ESEGUIRE UN COMANDO NEL FOGLIO DEL COMMERCIALISTA
 * SCEGLIENDOSI IL NOME (radiografia 6/9/2026).
 *
 * Nel file degli ordini finiscono di peso il nome del cliente, quello del
 * negozio e quello del fattorino: testo che scrivono loro. Il codice li metteva
 * fra virgolette e raddoppiava le virgolette interne - protegge dalla riga
 * spezzata, non dal resto. Per Excel un campo che comincia con `=`, `+`, `-` o
 * `@` non e' testo: e' una formula, e la esegue all'apertura del file.
 *
 * Queste prove non cercano una parola nel sorgente: ESEGUONO la composizione
 * del file e poi RILEGGONO il CSV cella per cella, come farebbe il foglio di
 * calcolo. Se torna a uscire una cella che comincia per formula, diventano
 * rosse.
 */

/** Il lettore di CSV che fa le veci di Excel: virgolette, `;`, a capo. */
function leggiCsv(testo: string): string[][] {
  const senzaBom = testo.startsWith(BOM_EXCEL) ? testo.slice(1) : testo;
  const righe: string[][] = [];
  let riga: string[] = [];
  let campo = '';
  let dentroVirgolette = false;

  for (let i = 0; i < senzaBom.length; i++) {
    const c = senzaBom[i];
    if (dentroVirgolette) {
      if (c === '"') {
        if (senzaBom[i + 1] === '"') { campo += '"'; i++; }
        else dentroVirgolette = false;
      } else campo += c;
    } else if (c === '"') {
      dentroVirgolette = true;
    } else if (c === ';') {
      riga.push(campo); campo = '';
    } else if (c === '\n') {
      riga.push(campo); righe.push(riga); riga = []; campo = '';
    } else {
      campo += c;
    }
  }
  riga.push(campo);
  righe.push(riga);
  return righe;
}

/** Quello che il foglio di calcolo eseguirebbe invece di mostrarlo. */
function sarebbeUnaFormula(cella: string): boolean {
  const nudo = cella.replace(/^[\s\u0000-\u001F\u00A0\u200B-\u200F\uFEFF]+/, '');
  if (nudo === '') return false;
  if (/^-?\d+(?:[.,]\d+)?$/.test(nudo)) return false; // un numero non e' un calcolo
  return ['=', '+', '-', '@'].includes(nudo[0]);
}

const VELENI = [
  '=1+1',
  '=HYPERLINK("http://sito-finto","Fattura")',
  '+1+1',
  '-2+3',
  '@SUM(A1:A9)',
  '\t=1+1',
  ' =cmd|\' /C calc\'!A0',
  '\r=1+1',
];

function ordineAvvelenato(veleno: string, i = 0): OrdineDaEsportare {
  return {
    id: `o${i}`,
    created_at: '2026-09-08T10:00:00Z',
    delivery_full_name: veleno,
    delivery_city: veleno,
    delivery_status: veleno,
    total_price: 1234.5,
    seller: { store_name: veleno },
    rider: { full_name: veleno },
  };
}

function raccolta(righe: OrdineDaEsportare[]): RaccoltaOrdini {
  return { righe, completo: true, letture: 1 };
}

describe('il campo che sembra una formula esce inerte', () => {
  it('mette un apostrofo davanti a ognuno dei quattro avvii di formula', () => {
    for (const veleno of VELENI) {
      const uscita = campoCsvSicuro(veleno);
      expect(uscita, `veleno: ${JSON.stringify(veleno)}`).toBe(`'${veleno}`);
      expect(sarebbeUnaFormula(uscita), `veleno: ${JSON.stringify(veleno)}`).toBe(false);
    }
  });

  it('lascia stare il testo normale e i numeri, anche negativi', () => {
    expect(campoCsvSicuro('Panificio Garetti')).toBe('Panificio Garetti');
    expect(campoCsvSicuro('1234,50')).toBe('1234,50');   // la colonna dei totali si somma
    expect(campoCsvSicuro('-12,50')).toBe('-12,50');     // un rimborso resta un numero
    expect(campoCsvSicuro('0')).toBe('0');
    expect(campoCsvSicuro(null)).toBe('');
    expect(campoCsvSicuro(undefined)).toBe('');
  });

  it('non rinuncia alla difesa vecchia: virgolette e punto e virgola non spezzano la riga', () => {
    const nome = 'Bar "Da Gino"; Piacenza\ncon a capo';
    const csv = componiCsv([['ID', 'Negozio'], ['o1', nome]]);
    const righe = leggiCsv(csv);
    expect(righe).toHaveLength(2);
    expect(righe[1]).toHaveLength(2);
    expect(righe[1][1]).toBe(nome);
  });
});

describe('il file degli ordini, riletto cella per cella', () => {
  it('non contiene NESSUNA cella che Excel eseguirebbe, su nessun campo di testo', () => {
    const ordini = VELENI.map((v, i) => ordineAvvelenato(v, i));
    const celle = leggiCsv(contenutoCsvOrdini(raccolta(ordini))).flat();

    expect(celle.length).toBeGreaterThan(VELENI.length * INTESTAZIONI_CSV_ORDINI.length);
    const eseguibili = celle.filter(sarebbeUnaFormula);
    expect(eseguibili).toEqual([]);
  });

  it('la difesa vale per il cliente, la citta, il negozio, il rider e lo stato, non solo per il negozio', () => {
    const righe = leggiCsv(contenutoCsvOrdini(raccolta([ordineAvvelenato('=1+1')])));
    const riga = righe[1];
    // ID, Data, Cliente, Citta, Negozio, Rider, Stato, Totale
    for (const colonna of [2, 3, 4, 5, 6]) {
      expect(riga[colonna], `colonna ${INTESTAZIONI_CSV_ORDINI[colonna]}`).toBe("'=1+1");
    }
  });

  it('il link fatto passare per fattura arriva come testo, virgolette comprese', () => {
    const veleno = '=HYPERLINK("http://sito-finto","Fattura")';
    const righe = leggiCsv(contenutoCsvOrdini(raccolta([ordineAvvelenato(veleno)])));
    expect(righe[1][4]).toBe(`'${veleno}`);
    expect(righe[1][4].startsWith('=')).toBe(false);
  });

  it('il totale resta un numero: la colonna dei soldi si somma ancora', () => {
    const ordini = [ordineAvvelenato('=1+1')];
    ordini[0].total_price = 1234.5;
    const righe = leggiCsv(contenutoCsvOrdini(raccolta(ordini)));
    expect(righe[1][7]).toBe('1234,50');
  });

  it('il file comincia col segno che dice a Excel che e UTF-8', () => {
    expect(contenutoFileCsv([['a']]).startsWith(BOM_EXCEL)).toBe(true);
    expect(contenutoCsvOrdini(raccolta([ordineAvvelenato('Pane Quotidiano')])).startsWith(BOM_EXCEL)).toBe(true);
  });
});
