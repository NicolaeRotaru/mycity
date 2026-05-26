import { describe, it, expect } from 'vitest';
import { COPY, pluralize } from '@/lib/copy';

describe('COPY constants', () => {
  it('has actions namespace', () => {
    expect(COPY.actions.save).toBe('Salva');
    expect(COPY.actions.cancel).toBe('Annulla');
    expect(COPY.actions.confirm).toBe('Conferma');
  });

  it('has states namespace', () => {
    expect(COPY.states.loading).toMatch(/Caricamento/);
    expect(COPY.states.saving).toMatch(/Salvataggio/);
  });

  it('has errors namespace', () => {
    expect(COPY.errors.generic).toBeTruthy();
    expect(COPY.errors.unauthorized).toMatch(/accedere/);
    expect(COPY.errors.invalidEmail).toMatch(/Email/);
  });

  it('has toasts namespace', () => {
    expect(COPY.toasts.saved).toBe('Salvato.');
    expect(COPY.toasts.deleted).toBe('Eliminato.');
    expect(COPY.toasts.copied).toMatch(/Copiato/);
  });
});

describe('pluralize', () => {
  it('returns singular for n=1', () => {
    expect(pluralize(1, 'prodotto', 'prodotti')).toBe('1 prodotto');
  });

  it('returns plural for n=0', () => {
    expect(pluralize(0, 'prodotto', 'prodotti')).toBe('0 prodotti');
  });

  it('returns plural for n>1', () => {
    expect(pluralize(5, 'prodotto', 'prodotti')).toBe('5 prodotti');
    expect(pluralize(100, 'prodotto', 'prodotti')).toBe('100 prodotti');
  });

  it('handles giorno/giorni', () => {
    expect(pluralize(1, 'giorno', 'giorni')).toBe('1 giorno');
    expect(pluralize(7, 'giorno', 'giorni')).toBe('7 giorni');
  });
});
