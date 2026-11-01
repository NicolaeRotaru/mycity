/**
 * 1/11/2026 (ondata 5) — «VENDUTO DA» SPARIVA SENZA UNA RIGA NEI LOG.
 *
 * In produzione la vista seller_public_profiles non ha ancora le colonne della
 * migrazione 126. Quando la lettura nel browser fallisce, il riquadro tornava
 * `null` e basta: `logger.error` nel browser in produzione non scrive in console.
 * La prova rende il componente VERO con una lettura fallita e pretende una riga
 * console.error che dica quale negozio e perche'.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';

const stato = vi.hoisted(() => ({ risposta: { data: undefined as unknown, error: null as unknown } }));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...vero, useQuery: () => stato.risposta };
});

// renderToString non fa girare gli effetti: qui girano subito, come nel browser dopo il disegno.
vi.mock('react', async (importOriginal) => {
  const vero = await importOriginal<typeof import('react')>();
  return { ...vero, useEffect: (fn: () => void) => { fn(); } };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));

import { VendutoDa } from '@/components/products/VendutoDa';

const SELLER = '11111111-2222-3333-4444-555555555555';

describe('«Venduto da»: se la vista dice no, resta una traccia', () => {
  let spia: { mock: { calls: unknown[][] }; mockRestore: () => void };
  beforeEach(() => {
    spia = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    spia.mockRestore();
  });

  it('una lettura fallita scrive console.error con negozio e motivo', () => {
    const errore = Object.assign(new Error('column seller_public_profiles.business_legal_name does not exist'), {
      code: '42703',
    });
    stato.risposta = { data: undefined, error: errore };
    const html = renderToString(<VendutoDa sellerId={SELLER} storeName="Pane Quotidiano" />);
    expect(html).toBe('');
    const righe = spia.mock.calls.filter((c: unknown[]) => String(c[0]).includes('[venduto-da]'));
    expect(righe.length).toBe(1);
    expect(righe[0][1]).toMatchObject({ sellerId: SELLER, storeName: 'Pane Quotidiano', codice: '42703' });
    expect(String((righe[0][1] as { motivo: string }).motivo)).toContain('business_legal_name');
  });

  it('una lettura riuscita non scrive niente e disegna il riquadro', () => {
    stato.risposta = {
      data: { store_name: 'Pane Quotidiano', store_address: 'Via Roma 1, Piacenza', store_phone: null },
      error: null,
    };
    const html = renderToString(<VendutoDa sellerId={SELLER} />);
    expect(html).toContain('Venduto da');
    expect(html).toContain('Pane Quotidiano');
    expect(spia.mock.calls.filter((c: unknown[]) => String(c[0]).includes('[venduto-da]')).length).toBe(0);
  });
});
