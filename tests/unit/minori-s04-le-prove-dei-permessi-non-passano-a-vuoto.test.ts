import { describe, it, expect } from 'vitest';
import { letturaNegata, chiamataNegata } from '../integration/security/esito-dei-permessi';

/**
 * 5/11/2026 (S04, scheda 482) — Le prove d'integrazione sui permessi non girano qui (vogliono un
 * Supabase vero). Qui si prova il loro giudice: cosa conta come «negato».
 */
describe('il giudice delle prove sui permessi', () => {
  it('un errore di rete non è un permesso negato', () => {
    const rete = { code: '', message: 'TypeError: fetch failed' };
    expect(letturaNegata({ data: null, error: rete })).toBe(false);
    expect(chiamataNegata(rete)).toBe(false);
  });

  it('«ordine non trovato» da una funzione che l’anonimo può eseguire non è un permesso negato', () => {
    expect(chiamataNegata({ code: 'P0001', message: 'ORDER_NOT_FOUND' })).toBe(false);
  });

  it('il permesso negato del database è un «negato»', () => {
    expect(chiamataNegata({ code: '42501', message: 'permission denied for function cancel_order' })).toBe(true);
    expect(chiamataNegata({ code: 'PGRST202', message: 'Could not find the function' })).toBe(true);
    expect(letturaNegata({ data: null, error: { code: '42501', message: 'permission denied for table orders' } })).toBe(true);
  });

  it('zero righe senza errore è un «negato» (la regola filtra), righe lette no', () => {
    expect(letturaNegata({ data: [], error: null })).toBe(true);
    expect(letturaNegata({ data: [{ id: 1 }], error: null })).toBe(false);
  });
});
