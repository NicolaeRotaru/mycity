import { describe, it, expect } from 'vitest';
import {
  isStale,
  deliveryLabelFrom,
  normalizeLabel,
  num,
  EXTERNAL_TTL_MS,
} from '@/lib/products/externalSyncShared';

describe('isStale', () => {
  it('mai sincronizzato → stale', () => {
    expect(isStale(null)).toBe(true);
    expect(isStale(undefined)).toBe(true);
    expect(isStale('')).toBe(true);
  });

  it('data non valida → stale', () => {
    expect(isStale('non-una-data')).toBe(true);
  });

  it('appena sincronizzato → fresco', () => {
    expect(isStale(new Date().toISOString())).toBe(false);
  });

  it('oltre il TTL → stale', () => {
    const old = new Date(Date.now() - EXTERNAL_TTL_MS - 60_000).toISOString();
    expect(isStale(old)).toBe(true);
  });

  it('entro il TTL → fresco', () => {
    const recent = new Date(Date.now() - EXTERNAL_TTL_MS / 2).toISOString();
    expect(isStale(recent)).toBe(false);
  });

  it('rispetta un TTL custom', () => {
    const t = new Date(Date.now() - 10_000).toISOString();
    expect(isStale(t, 5_000)).toBe(true);
    expect(isStale(t, 60_000)).toBe(false);
  });
});

describe('deliveryLabelFrom', () => {
  it('preferisce l\'etichetta esplicita', () => {
    expect(deliveryLabelFrom({ delivery_label: '  Consegna in 2 giorni ' })).toBe('Consegna in 2 giorni');
  });

  it('range min-max', () => {
    expect(deliveryLabelFrom({ delivery_min_days: 2, delivery_max_days: 5 })).toBe('2-5 giorni');
  });

  it('min uguale a max → singolo', () => {
    expect(deliveryLabelFrom({ delivery_min_days: 3, delivery_max_days: 3 })).toBe('3 giorni');
  });

  it('solo max', () => {
    expect(deliveryLabelFrom({ delivery_max_days: 4 })).toBe('4 giorni');
  });

  it('solo min', () => {
    expect(deliveryLabelFrom({ delivery_min_days: 7 })).toBe('7+ giorni');
  });

  it('nessun dato → null', () => {
    expect(deliveryLabelFrom({})).toBeNull();
  });
});

describe('normalizeLabel', () => {
  it('minuscolo, senza accenti, spazi collassati', () => {
    expect(normalizeLabel('Crescita  Personale')).toBe('crescita personale');
    expect(normalizeLabel('Caffè')).toBe('caffe');
    expect(normalizeLabel('Audio-libri!')).toBe('audio libri');
  });
});

describe('num', () => {
  it('accetta solo numeri finiti', () => {
    expect(num(3.5)).toBe(3.5);
    expect(num(0)).toBe(0);
    expect(num('3')).toBeNull();
    expect(num(NaN)).toBeNull();
    expect(num(Infinity)).toBeNull();
    expect(num(null)).toBeNull();
  });
});
