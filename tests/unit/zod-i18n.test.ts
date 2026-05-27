import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Side-effect import: setta z.setErrorMap globale in italiano
import '@/lib/zod-i18n';

/**
 * Unit test per lib/zod-i18n: messaggi errore Zod in italiano.
 *
 * Esperti: Content Designer: "Tutti gli errori validation in IT, niente
 * 'String must contain at least X characters'."
 */

describe('zod-i18n - messaggi italiani', () => {
  it('required string → "Campo obbligatorio"', () => {
    const schema = z.object({ name: z.string().min(1) });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toMatch(/obbligatori/i);
    }
  });

  it('too_small string min 5 → "Almeno 5 caratteri"', () => {
    const schema = z.string().min(5);
    const result = schema.safeParse('ab');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toMatch(/almeno 5/i);
    }
  });

  it('too_small number → "Valore minimo: X"', () => {
    const schema = z.number().min(10);
    const result = schema.safeParse(5);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toMatch(/minimo.*10/i);
    }
  });

  it('invalid email → mentions email', () => {
    const schema = z.string().email();
    const result = schema.safeParse('not-email');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toMatch(/email/i);
    }
  });

  it('required number missing → "Campo obbligatorio"', () => {
    const schema = z.object({ age: z.number() });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toMatch(/obbligatori/i);
    }
  });
});
