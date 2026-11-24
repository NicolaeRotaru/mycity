import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { apiErrorMessage, friendlyError } from '@/lib/errors';

/**
 * R07-010 — `lib/errors.ts` entra in ogni pagina dal piede del sito. Importarlo non deve accendere il
 * traduttore italiano di Zod (e portarsi dietro Zod): il traduttore arriva a parte, da chi lo usa.
 * Le frasi italiane dei testi del server restano.
 */
describe('lib/errors non accende il traduttore di Zod', () => {
  it('dopo aver importato lib/errors, Zod parla ancora col suo testo predefinito', () => {
    expect(z.string().min(1).safeParse('').error?.issues[0]?.message).toBe('String must contain at least 1 character(s)');
  });

  it('i testi inglesi di Zod che arrivano dal server escono comunque in italiano', () => {
    const msg = apiErrorMessage({ ok: false, error: { code: 'INVALID_REQUEST', message: 'String must contain at most 120 character(s)' } }, 'x');
    expect(friendlyError(new Error(msg))).toBe('Massimo 120 caratteri');
  });
});
