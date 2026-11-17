/**
 * R03-012 — Il cuore dei preferiti dopo due salvataggi falliti, e con una richiesta che non risponde.
 *
 * (a) Due tocchi rapidi, tutte e due le scritture rifiutate: il database resta vuoto, quindi il cuore
 *     deve tornare vuoto. Prima il secondo rifiuto ribaltava il cuore del secondo tocco e lo lasciava
 *     pieno.
 * (b) Una scrittura che non risponde mai non deve tenere ferma per sempre la fila del prodotto: i
 *     tocchi dopo devono arrivare al server, e il cuore deve tornare coerente.
 *
 * Gira la regola vera (`opzioniDelTocco`) dentro la cache vera di react-query, con un finto server
 * che tiene le righe. L'orologio è finto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { CHIAVE_PREFERITI, opzioniDelTocco, type Verso } from '@/lib/preferiti/tocco-del-cuore';

const PRODOTTO = 'prodotto-3';

type Risposta = 'accetta' | 'rifiuta' | 'silenzio';

/** Un finto server: risponde dopo 300 ms come gli diciamo, o non risponde mai. */
function banco(inizio: string[], risposte: Risposta[]) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(CHIAVE_PREFERITI, new Set<string>(inizio));
  const righe = new Set<string>(inizio);
  const scritte: Verso[] = [];
  const osservatore = new MutationObserver(
    qc,
    opzioniDelTocco(qc, (id, verso) => {
      scritte.push(verso);
      const risposta = risposte.shift() ?? 'accetta';
      if (risposta === 'silenzio') return new Promise<void>(() => {});
      return new Promise<void>((ok, ko) => {
        setTimeout(() => {
          if (risposta === 'rifiuta') return ko(new Error('rete caduta'));
          if (verso === 'aggiungi') righe.add(id);
          else righe.delete(id);
          ok();
        }, 300);
      });
    }),
  );
  const esiti: Array<'in corso' | 'ok' | 'errore'> = [];
  const tocca = () => {
    const i = esiti.push('in corso') - 1;
    osservatore.mutate(PRODOTTO).then(
      () => {
        esiti[i] = 'ok';
      },
      () => {
        esiti[i] = 'errore';
      },
    );
  };
  const pieno = () => qc.getQueryData<Set<string>>(CHIAVE_PREFERITI)?.has(PRODOTTO);
  return { qc, righe, scritte, esiti, tocca, pieno };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R03-012 (a) — due salvataggi falliti in fila', () => {
  it('aggiungi e togli, tutti e due rifiutati: cuore vuoto, come il database', async () => {
    const b = banco([], ['rifiuta', 'rifiuta']);
    b.tocca(); // aggiungi
    b.tocca(); // togli
    await vi.advanceTimersByTimeAsync(0);
    expect(b.pieno(), 'dopo il secondo tocco il cuore è vuoto, come scelto').toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(b.scritte).toEqual(['aggiungi', 'togli']);
    expect(b.esiti).toEqual(['errore', 'errore']);
    expect(b.righe.has(PRODOTTO), 'nel database non è entrato niente').toBe(false);
    expect(b.pieno(), 'cuore pieno su un preferito che non è salvato').toBe(false);
  });

  it('togli e aggiungi, tutti e due rifiutati, su un preferito salvato: cuore pieno', async () => {
    const b = banco([PRODOTTO], ['rifiuta', 'rifiuta']);
    b.tocca(); // togli
    b.tocca(); // aggiungi
    await vi.advanceTimersByTimeAsync(2_000);
    expect(b.righe.has(PRODOTTO)).toBe(true);
    expect(b.pieno(), 'cuore vuoto su un preferito che è ancora salvato').toBe(true);
  });

  it('il primo riesce e il secondo è rifiutato: il cuore resta su quello che il server ha confermato', async () => {
    const b = banco([], ['accetta', 'rifiuta']);
    b.tocca(); // aggiungi, riesce
    b.tocca(); // togli, rifiutato
    await vi.advanceTimersByTimeAsync(2_000);
    expect(b.righe.has(PRODOTTO)).toBe(true);
    expect(b.pieno()).toBe(true);
  });
});

describe('R03-012 (b) — una richiesta che non risponde', () => {
  it('non blocca la fila: il tocco dopo arriva al server, e il cuore segue quello che è stato scritto', async () => {
    const b = banco([], ['silenzio', 'accetta']);
    b.tocca(); // aggiungi, il server tace
    b.tocca(); // togli
    await vi.advanceTimersByTimeAsync(0);
    expect(b.scritte, 'una scrittura alla volta').toEqual(['aggiungi']);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(b.scritte, 'la scrittura senza risposta ha fermato la fila').toEqual(['aggiungi', 'togli']);
    expect(b.esiti).toEqual(['errore', 'ok']);
    expect(b.righe.has(PRODOTTO)).toBe(false);
    expect(b.pieno()).toBe(false);
  });

  it('un tocco solo senza risposta: il cuore torna vuoto e chi ha toccato riceve l’errore', async () => {
    const b = banco([], ['silenzio', 'accetta']);
    b.tocca();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.pieno(), 'il cuore cambia subito').toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(b.esiti, 'il tocco resta appeso per sempre').toEqual(['errore']);
    expect(b.pieno(), 'cuore pieno su una scrittura mai confermata').toBe(false);

    // E la fila è libera: un tocco nuovo parte subito e arriva al server.
    b.tocca();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(b.scritte).toEqual(['aggiungi', 'aggiungi']);
    expect(b.righe.has(PRODOTTO)).toBe(true);
    expect(b.pieno()).toBe(true);
    expect(b.esiti).toEqual(['errore', 'ok']);
  });
});

/**
 * Giro di correzione (casi del revisore): la scrittura scaduta non si ferma. Se arriva dopo che la
 * fila è andata avanti, e dopo la rilettura, il cuore deve comunque finire su quello che c'è nel
 * database. Qui la rilettura è vera: un osservatore della lista con una lettura che guarda le righe
 * del finto server, come `useFavorites`. Ogni scrittura ha il suo ritardo; arriva quando scade.
 */
type Scrittura = { ritardo: number; esito: 'accetta' | 'rifiuta' };

function bancoConRilettura(inizio: string[], programma: Scrittura[]) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  qc.setQueryData(CHIAVE_PREFERITI, new Set<string>(inizio));
  const righe = new Set<string>(inizio);
  const arrivate: string[] = [];
  const lista = new QueryObserver(qc, {
    queryKey: CHIAVE_PREFERITI,
    queryFn: async () => new Set<string>(righe),
    staleTime: Infinity,
  });
  const smetti = lista.subscribe(() => {});
  const osservatore = new MutationObserver(
    qc,
    opzioniDelTocco(qc, (id, verso) => {
      const { ritardo, esito } = programma.shift() ?? { ritardo: 300, esito: 'accetta' };
      return new Promise<void>((ok, ko) => {
        setTimeout(() => {
          arrivate.push(`${verso} ${esito}`);
          if (esito === 'rifiuta') return ko(new Error('rete caduta'));
          if (verso === 'aggiungi') righe.add(id);
          else righe.delete(id);
          ok();
        }, ritardo);
      });
    }),
  );
  const esiti: Array<'in corso' | 'ok' | 'errore'> = [];
  const tocca = () => {
    const i = esiti.push('in corso') - 1;
    osservatore.mutate(PRODOTTO).then(
      () => {
        esiti[i] = 'ok';
      },
      () => {
        esiti[i] = 'errore';
      },
    );
  };
  const pieno = () => qc.getQueryData<Set<string>>(CHIAVE_PREFERITI)?.has(PRODOTTO);
  return { qc, righe, arrivate, esiti, tocca, pieno, smetti };
}

describe('R03-012 giro di correzione — la scrittura scaduta che arriva comunque', () => {
  it('preferito salvato, un «togli» che risponde dopo 12 s: alla fine cuore e database dicono la stessa cosa', async () => {
    const b = bancoConRilettura([PRODOTTO], [{ ritardo: 12_000, esito: 'accetta' }]);
    b.tocca(); // togli
    await vi.advanceTimersByTimeAsync(0);
    expect(b.pieno(), 'il cuore si svuota subito').toBe(false);

    await vi.advanceTimersByTimeAsync(10_500);
    expect(b.esiti, 'a 10 s la scrittura vale come rifiutata: la fila non resta ferma').toEqual(['errore']);
    expect(b.pieno(), 'a 10 s il cuore torna allo stato confermato').toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(b.arrivate, 'il «togli» è arrivato lo stesso, a 12 s').toEqual(['togli accetta']);
    expect(b.righe.has(PRODOTTO), 'nel database il preferito non c’è più').toBe(false);
    expect(b.pieno(), 'cuore pieno su un preferito che non è salvato').toBe(false);
    b.smetti();
  });

  it('aggiungi riuscito, togli che arriva a 11,1 s, aggiungi riuscito a 10,6 s: il cuore segue il database', async () => {
    const b = bancoConRilettura(
      [],
      [
        { ritardo: 300, esito: 'accetta' }, // aggiungi: arriva a 0,3 s
        { ritardo: 10_800, esito: 'accetta' }, // togli: parte a 0,3 s, scade a 10,3 s, arriva a 11,1 s
        { ritardo: 300, esito: 'accetta' }, // aggiungi: parte a 10,3 s, arriva a 10,6 s
      ],
    );
    b.tocca(); // aggiungi
    b.tocca(); // togli
    b.tocca(); // aggiungi
    await vi.advanceTimersByTimeAsync(0);
    expect(b.pieno()).toBe(true);

    await vi.advanceTimersByTimeAsync(10_700);
    expect(b.arrivate).toEqual(['aggiungi accetta', 'aggiungi accetta']);
    expect(b.esiti, 'la fila è andata avanti').toEqual(['ok', 'errore', 'ok']);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(b.arrivate, 'il togli tardivo arriva per ultimo').toEqual(['aggiungi accetta', 'aggiungi accetta', 'togli accetta']);
    expect(b.righe.has(PRODOTTO)).toBe(false);
    expect(b.pieno(), 'cuore pieno con il database vuoto').toBe(false);
    b.smetti();
  });

  it('la scrittura scaduta che alla fine fallisce: il cuore resta su quello del database', async () => {
    const b = bancoConRilettura([PRODOTTO], [{ ritardo: 12_000, esito: 'rifiuta' }]);
    b.tocca(); // togli
    await vi.advanceTimersByTimeAsync(20_000);
    expect(b.esiti).toEqual(['errore']);
    expect(b.righe.has(PRODOTTO)).toBe(true);
    expect(b.pieno()).toBe(true);
    b.smetti();
  });

  it('la scrittura scaduta arriva mentre altri tocchi sono in fila: niente stato di passaggio, e alla fine il database', async () => {
    const b = bancoConRilettura(
      [],
      [
        { ritardo: 12_000, esito: 'accetta' }, // aggiungi: scade a 10 s, arriva a 12 s
        { ritardo: 4_000, esito: 'accetta' }, // aggiungi (tocco a 11 s): parte a 11 s, arriva a 15 s
        { ritardo: 300, esito: 'accetta' }, // togli (tocco a 11,5 s): parte a 15 s, arriva a 15,3 s
      ],
    );
    b.tocca(); // aggiungi, il server risponde tardi
    await vi.advanceTimersByTimeAsync(11_000);
    expect(b.pieno(), 'dopo la scadenza il cuore è tornato vuoto').toBe(false);
    b.tocca(); // aggiungi
    await vi.advanceTimersByTimeAsync(500);
    b.tocca(); // togli: l'ultima scelta è il cuore vuoto
    await vi.advanceTimersByTimeAsync(1_000);
    expect(b.righe.has(PRODOTTO), 'a 12 s l’aggiungi tardivo è arrivato').toBe(true);
    expect(b.pieno(), 'a metà fila resta quello che il cliente ha scelto, non uno stato di passaggio').toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(b.esiti).toEqual(['errore', 'ok', 'ok']);
    expect(b.righe.has(PRODOTTO)).toBe(false);
    expect(b.pieno()).toBe(false);
    b.smetti();
  });
});
