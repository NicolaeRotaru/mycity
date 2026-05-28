import { describe, it, expect } from 'vitest';
import { apiErrorMessage } from '@/lib/errors';

/**
 * apiErrorMessage deve estrarre il messaggio sia dal formato ApiErrors
 * { ok:false, error:{ code, message } } sia dal legacy { error: "stringa" }.
 * Bug fix sistemico: i caller facevano new Error(data.error) → "[object Object]".
 */
describe('apiErrorMessage', () => {
  it('estrae message dal formato ApiErrors { error: { code, message } }', () => {
    const body = { ok: false, error: { code: 'INVALID_REQUEST', message: 'Email non valida' } };
    expect(apiErrorMessage(body)).toBe('Email non valida');
  });

  it('estrae stringa dal formato legacy { error: "..." }', () => {
    expect(apiErrorMessage({ error: 'Stock insufficiente' })).toBe('Stock insufficiente');
  });

  it('usa fallback se body è null/undefined', () => {
    expect(apiErrorMessage(null, 'Fallback')).toBe('Fallback');
    expect(apiErrorMessage(undefined, 'Fallback')).toBe('Fallback');
  });

  it('usa fallback se body non ha error', () => {
    expect(apiErrorMessage({ ok: true, data: {} }, 'Fallback')).toBe('Fallback');
  });

  it('usa fallback se error è oggetto senza message', () => {
    expect(apiErrorMessage({ error: { code: 'X' } }, 'Fallback')).toBe('Fallback');
  });

  it('usa fallback se error.message è stringa vuota', () => {
    expect(apiErrorMessage({ error: { code: 'X', message: '   ' } }, 'Fallback')).toBe('Fallback');
  });

  it('usa fallback se error è stringa vuota', () => {
    expect(apiErrorMessage({ error: '' }, 'Fallback')).toBe('Fallback');
  });

  it('default fallback quando non fornito', () => {
    expect(apiErrorMessage({})).toBe('Operazione non riuscita');
  });

  it('NON ritorna mai [object Object] (il bug che previene)', () => {
    const body = { ok: false, error: { code: 'C', message: 'Messaggio reale' } };
    const result = apiErrorMessage(body);
    expect(result).not.toContain('[object Object]');
    expect(result).toBe('Messaggio reale');
  });
});
