import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodFieldErrors, zodFirstFieldMessage } from '@/lib/zod-field-errors';

const schema = z.object({
  email: z.string().email('Email non valida'),
  nested: z.object({ handle: z.string().min(3, 'Troppo corto') }),
});

describe('zodFieldErrors', () => {
  it('maps every field path to its message', () => {
    const r = schema.safeParse({ email: 'bad', nested: { handle: 'a' } });
    expect(r.success).toBe(false);
    if (!r.success) {
      const map = zodFieldErrors(r.error);
      expect(map['email']).toBe('Email non valida');
      expect(map['nested.handle']).toBe('Troppo corto');
    }
  });
});

describe('zodFirstFieldMessage', () => {
  it('prefixes the field label when provided', () => {
    const r = schema.safeParse({ email: 'bad', nested: { handle: 'abc' } });
    if (!r.success) {
      expect(zodFirstFieldMessage(r.error, { email: 'Email' })).toBe('Email: Email non valida');
    }
  });

  it('uses the root path label for nested fields', () => {
    const r = schema.safeParse({ email: 'ok@x.it', nested: { handle: 'a' } });
    if (!r.success) {
      expect(zodFirstFieldMessage(r.error, { nested: 'Profilo' })).toBe('Profilo: Troppo corto');
    }
  });

  it('falls back to the raw message without labels', () => {
    const r = schema.safeParse({ email: 'bad', nested: { handle: 'abc' } });
    if (!r.success) {
      expect(zodFirstFieldMessage(r.error)).toBe('Email non valida');
    }
  });
});
