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

  it('le frasi giuste restano quelle di prima', () => {
    expect(primo(z.string().max(120).safeParse('a'.repeat(121)))).toBe('Massimo 120 caratteri');
    expect(primo(z.string().min(1).safeParse(''))).toBe('Campo obbligatorio');
    expect(primo(z.string().email().safeParse('x'))).toBe('Email non valida');
  });
});
