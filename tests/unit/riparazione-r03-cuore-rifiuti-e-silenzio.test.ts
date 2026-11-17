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
import { MutationObserver, QueryClient } from '@tanstack/react-query';
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
