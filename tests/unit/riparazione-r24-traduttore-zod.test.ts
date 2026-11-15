import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import '@/lib/zod-i18n';

/**
 * 13/11/2026 (R24-019) — IL TRADUTTORE DEGLI ERRORI DI ZOD AVEVA TRE FRASI SBAGLIATE.
 *
 * «Atteso number» (il tipo tecnico, in inglese), «Seleziona almeno 1 elementi» (il
 * plurale fisso) e «Valore non valido. Usa: valore_a, valore_b» (le chiavi interne
 * dell'elenco). Qui gli schemi veri passano dal traduttore vero.
 */
const primo = (r: { success: boolean; error?: z.ZodError }) => r.error?.issues[0]?.message ?? '';

describe('il traduttore di Zod parla italiano corretto', () => {
  it('il tipo sbagliato si dice in italiano, senza il nome tecnico', () => {
    const msg = primo(z.object({ prezzo: z.number() }).safeParse({ prezzo: 'tre' }));
    expect(msg).not.toMatch(/number|Atteso/);
    expect(msg).toBe('Valore non valido: serve un numero');
    expect(primo(z.object({ prezzo: z.number() }).safeParse({}))).toBe('Campo obbligatorio');
  });

  it('«almeno 1 elemento», al singolare; «almeno 2 elementi», al plurale', () => {
    expect(primo(z.array(z.string()).min(1).safeParse([]))).toBe('Seleziona almeno 1 elemento');
    expect(primo(z.array(z.string()).min(2).safeParse(['a']))).toBe('Seleziona almeno 2 elementi');
  });

  it('un valore fuori elenco non mostra le chiavi interne', () => {
    const msg = primo(z.enum(['valore_a', 'valore_b']).safeParse('c'));
    expect(msg).not.toMatch(/valore_a|valore_b/);
    expect(msg).toMatch(/^Valore non valido/);
  });

  it('il limite escluso non si dice come un minimo: positive() su 0 vuole «maggiore di 0»', () => {
    expect(primo(z.number().positive().safeParse(0))).toBe('Deve essere maggiore di 0');
    expect(primo(z.number().gt(5).safeParse(5))).toBe('Deve essere maggiore di 5');
    expect(primo(z.number().negative().safeParse(0))).toBe('Deve essere minore di 0');
    expect(primo(z.number().lt(10).safeParse(10))).toBe('Deve essere minore di 10');
    // Il limite compreso resta «Valore minimo/massimo».
    expect(primo(z.number().min(1).safeParse(0))).toBe('Valore minimo: 1');
    expect(primo(z.number().nonnegative().safeParse(-1))).toBe('Valore minimo: 0');
    expect(primo(z.number().max(10).safeParse(11))).toBe('Valore massimo: 10');
  });

  it('«Massimo 1 carattere», al singolare', () => {
    expect(primo(z.string().max(1).safeParse('ab'))).toBe('Massimo 1 carattere');
  });

  it('«Massimo 1 elemento» al singolare, «Massimo 3 elementi» al plurale (liste troppo lunghe)', () => {
    expect(primo(z.array(z.string()).max(1).safeParse(['a', 'b']))).toBe('Massimo 1 elemento');
    expect(primo(z.array(z.string()).max(3).safeParse(['a', 'b', 'c', 'd']))).toBe('Massimo 3 elementi');
  });

  it('le frasi giuste restano quelle di prima', () => {
    expect(primo(z.string().max(120).safeParse('a'.repeat(121)))).toBe('Massimo 120 caratteri');
    expect(primo(z.string().min(1).safeParse(''))).toBe('Campo obbligatorio');
    expect(primo(z.string().email().safeParse('x'))).toBe('Email non valida');
  });
});
