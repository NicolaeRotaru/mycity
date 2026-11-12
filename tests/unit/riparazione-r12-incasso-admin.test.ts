/**
 * R12-001 — Se il fattorino sparisce senza dichiarare i contanti, l'ordine
 * restava «in consegna» per sempre: l'amministratore poteva registrare
 * l'incasso solo su un ordine gia' consegnato, ma dalla migrazione 163 un
 * ordine in contanti non si consegna senza l'incasso. Qui: l'amministratore
 * registra dalla partenza della merce in poi (poi chiude con
 * `admin_chiudi_consegna`, provata in tests/sql/rls/riparazione-r12-chiudi-consegna.test.sql).
 */
import { describe, it, expect } from 'vitest';
import {
  motivoPerNonRegistrare,
  statiAmmessi,
  type OrdineDaIncassare,
} from '@/lib/cassa/registra-incasso';

const inStrada: OrdineDaIncassare = {
  id: 'o1',
  rider_id: 'fattorino-sparito',
  total_price: 25,
  rider_fee_cents: 300,
  shipping_cost: 3,
  pickup_in_store: false,
  payment_method: 'cod',
  payment_status: 'PENDING',
  delivery_status: 'OUT_FOR_DELIVERY',
  cash_confirmed_at: null,
  delivered_at: null,
};
const amministratore = { chi: 'amministratore', userId: 'capo' } as const;

describe('R12-001 il fattorino sparito non lascia l ordine in strada per sempre', () => {
  it('l amministratore registra i contanti di un ordine ancora in strada', () => {
    expect(motivoPerNonRegistrare(inStrada, amministratore)).toBeNull();
    expect(motivoPerNonRegistrare({ ...inStrada, delivery_status: 'PICKED_UP' }, amministratore)).toBeNull();
  });

  it('la scrittura nel database accetta gli stati in strada', () => {
    expect(statiAmmessi(amministratore)).toEqual(expect.arrayContaining(['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED']));
  });

  it('prima che la merce parta, no; e senza fattorino, no', () => {
    expect(motivoPerNonRegistrare({ ...inStrada, delivery_status: 'ACCEPTED' }, amministratore)).toBe('NON_ANCORA_CONSEGNATO');
    expect(motivoPerNonRegistrare({ ...inStrada, delivery_status: 'READY' }, amministratore)).toBe('NON_ANCORA_CONSEGNATO');
    expect(motivoPerNonRegistrare({ ...inStrada, rider_id: null }, amministratore)).toBe('SENZA_FATTORINO');
  });

  it('il fattorino resta com era: senza PICKED_UP, i contanti si dichiarano alla porta', () => {
    const fattorino = { chi: 'fattorino', userId: 'fattorino-sparito' } as const;
    expect(statiAmmessi(fattorino)).toEqual(['OUT_FOR_DELIVERY', 'DELIVERED']);
  });
});
