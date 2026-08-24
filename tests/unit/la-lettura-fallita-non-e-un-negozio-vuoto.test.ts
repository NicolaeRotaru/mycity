/**
 * 🧪 L'AREA VENDITORE — una lettura fallita non è un negozio senza ordini.
 *
 * Il conto che ha prodotto questo file, misurato il 23/8/2026 su `app/seller/`: **undici pagine,
 * ventinove letture, `isError` zero volte.** Otto pagine dichiarano un ripiego, quindi un
 * fallimento si disegna come «non c'è niente».
 *
 * Il caso peggiore cade sui soldi. La pagina dei Guadagni mostra la torre dei numeri a zero e
 * scrive «Ancora nessun ordine pagato con carta», mentre in cima dichiara «Incassi reali dai tuoi
 * ordini». Afferma di essere reale su dati che non ha mai ricevuto — al negoziante che paga il
 * canone, sul suo incasso.
 *
 * I casi qui sotto sono costruiti: mordono anche quando le pagine vere sono a posto. Una prova che
 * legge lo stato di oggi misura la fortuna, non la regola.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { quantiDi, vistaDaQuery } from '@/lib/vista-query';

describe('dalla lettura al verdetto', () => {
  it('IL CASO CHE HA GENERATO TUTTO: la lettura fallisce e NON si dice «non c\'è niente»', () => {
    // Esattamente la forma di app/seller/earnings: la funzione lancia, React Query alza isError,
    // `data` resta undefined e nella pagina scatta il ripiego `= []`.
    const v = vistaDaQuery<unknown[]>({ isPending: false, isError: true, error: new Error('rete'), data: undefined });
    expect(v.stato).toBe('rotto');
    expect(v.mostraErrore).toBe(true);
    expect(v.mostraVuoto).toBe(false);
    expect(v.mostraScheletro).toBe(false);
  });

  it('un errore senza oggetto è comunque un errore: la bandierina basta', () => {
    // Pretendere anche l'oggetto lascerebbe passare proprio il caso che si vuole fermare.
    expect(vistaDaQuery({ isError: true }).mostraErrore).toBe(true);
  });

  it('l\'errore batte tutto, anche quando un dato c\'è', () => {
    const v = vistaDaQuery({ isError: true, error: 'x', data: [1, 2, 3] });
    expect(v.stato).toBe('rotto');
  });

  it('«vuoto» esce solo dopo aver letto davvero', () => {
    const letto = vistaDaQuery({ isPending: false, data: [] });
    expect(letto.stato).toBe('vuoto');
    expect(letto.mostraVuoto).toBe(true);

    // Lettura finita ma nessun dato in mano: NON è vuoto. È il buco che il difetto sfruttava —
    // `isLoading` falso e `data` undefined facevano credere alla pagina di aver letto.
    const senzaDato = vistaDaQuery({ isPending: false, isLoading: false, data: undefined });
    expect(senzaDato.stato).not.toBe('vuoto');
    expect(senzaDato.mostraVuoto).toBe(false);
  });

  it('mentre legge mostra lo scheletro, e non dice niente sul mondo', () => {
    const v = vistaDaQuery({ isPending: true, data: undefined });
    expect(v.stato).toBe('carico');
    expect(v.mostraScheletro).toBe(true);
    expect(v.mostraVuoto).toBe(false);
    expect(v.mostraErrore).toBe(false);
  });

  it('con il dato in mano disegna, e il dato torna indietro', () => {
    const v = vistaDaQuery({ isPending: false, data: [{ id: 1 }] });
    expect(v.stato).toBe('pieno');
    expect(v.dati).toEqual([{ id: 1 }]);
    expect([v.mostraScheletro, v.mostraVuoto, v.mostraErrore]).toEqual([false, false, false]);
  });

  it('legge anche chi dichiara solo isLoading, non isPending', () => {
    // Le pagine vere sono scritte così: il verdetto non deve cambiare a seconda del nome usato.
    expect(vistaDaQuery({ isLoading: true, data: undefined }).mostraScheletro).toBe(true);
  });

  it('un oggetto singolo vale uno, non zero: la bacheca non è «vuota» perché non è un elenco', () => {
    // Il caso di app/seller/dashboard, che legge un oggetto `stats` e non una lista.
    expect(quantiDi({ ordini: 0 })).toBe(1);
    expect(quantiDi([])).toBe(0);
    expect(quantiDi(undefined)).toBe(0);
    expect(quantiDi(null)).toBe(0);
    expect(vistaDaQuery({ isPending: false, data: { ordini: 0 } }).stato).toBe('pieno');
  });

  it('un conteggio dichiarato da fuori vince su quello dedotto', () => {
    // Serve alle pagine che leggono un oggetto ma vogliono dire «vuoto» su un campo interno.
    expect(vistaDaQuery({ isPending: false, data: { righe: [] } }, { quanti: 0 }).stato).toBe('vuoto');
  });

  it('ogni verdetto accende AL MASSIMO una scorciatoia di render', () => {
    const casi = [
      { isPending: true },
      { isPending: false, data: [] },
      { isPending: false, data: [1] },
      { isError: true, error: 'x' },
      { isPending: false, data: undefined },
      { isError: true, data: [1] },
    ];
    for (const c of casi) {
      const v = vistaDaQuery(c);
      const accese = [v.mostraScheletro, v.mostraVuoto, v.mostraErrore].filter(Boolean).length;
      expect(accese, `due riquadri insieme per ${JSON.stringify(c)}`).toBeLessThanOrEqual(1);
    }
  });
});

describe('l\'invariante di STRUTTURA sulle pagine vere', () => {
  // Le prove qui sopra misurano la FUNZIONE. Questa misura le PAGINE, ed è quella che diventa rossa
  // se qualcuno rimette la forma malata: senza, avrei una regola scritta bene e nessuno obbligato a
  // passarci. È la malattia che questo cantiere paga da mesi — un cancello montato su una porta che
  // nessuno usa.
  const cartella = join(process.cwd(), 'app/seller');
  const pagine = readdirSync(cartella, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(cartella, d.name, 'page.tsx'))
    .filter((p) => existsSync(p));

  it('ci sono pagine da misurare: una lista vuota non è un verde', () => {
    expect(pagine.length).toBeGreaterThanOrEqual(10);
  });

  /**
   * Il testo senza commenti.
   *
   * Serve perché questi file SPIEGANO nei commenti proprio la forma che sorvegliano: la pagina dei
   * Guadagni cita `const { data: orders = [], isLoading }` per dire cosa c'era prima. Contarlo
   * sarebbe un rosso su una spiegazione — ed è successo davvero mentre scrivevo questa prova.
   */
  const senzaCommenti = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

  it('nessuna pagina si prende un ripiego direttamente dalla lettura', () => {
    // `const { data: orders = [], isLoading } = useQuery(...)` è la forma esatta del difetto: con la
    // lettura fallita `data` resta undefined e il ripiego prende il posto del dato.
    const colpevoli = pagine.filter((p) =>
      /const\s*\{[^}]*data:\s*\w+\s*=\s*(\[\]|\{\})/.test(senzaCommenti(readFileSync(p, 'utf8'))),
    );
    expect(colpevoli.map((p) => p.split('/').slice(-2).join('/'))).toEqual([]);
  });

  it('ogni pagina che legge qualcosa guarda anche se la lettura è fallita', () => {
    const cieche = pagine.filter((p) => {
      const src = readFileSync(p, 'utf8');
      if (!src.includes('useQuery')) return false;
      return !src.includes('mostraErrore') && !src.includes('isError');
    });
    expect(cieche.map((p) => p.split('/').slice(-2).join('/'))).toEqual([]);
  });

  it('nessuna lettura ingoia il proprio errore', () => {
    // `const { data } = await supabase...` senza leggere `error`: la lettura non fallisce MAI, torna
    // «riuscita» con la lista vuota. Il riquadro d'errore a valle non può servire a niente se il
    // guasto non arriva fin lì — è la forma che «Vicino a te» aveva sul lato cliente.
    const ingoiano = pagine.filter((p) => /const\s*\{\s*data\s*\}\s*=\s*await\s+supabase/.test(senzaCommenti(readFileSync(p, 'utf8'))));
    expect(ingoiano.map((p) => p.split('/').slice(-2).join('/'))).toEqual([]);
  });
});

describe('l\'invariante sull\'area venditore', () => {
  it('nessuna combinazione può dire «vuoto» senza un dato in mano', () => {
    // La griglia intera: se una sola combinazione dicesse «vuoto» senza dato, il difetto dei
    // Guadagni potrebbe tornare da un'altra porta.
    for (const isPending of [true, false, undefined]) {
      for (const isError of [true, false, undefined]) {
        for (const data of [undefined, null, [], [1], { a: 1 }]) {
          const v = vistaDaQuery({ isPending, isError, error: isError ? 'x' : undefined, data: data as never });
          if (v.mostraVuoto) {
            expect(data, 'ha detto «vuoto» senza avere un dato in mano').not.toBe(undefined);
            expect(data, 'ha detto «vuoto» senza avere un dato in mano').not.toBe(null);
            expect(isError, 'ha detto «vuoto» su una lettura fallita').not.toBe(true);
          }
        }
      }
    }
  });
});
