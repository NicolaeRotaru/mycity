// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R01-012 (27/11/2026) — La bozza della cassa (nome, telefono, indirizzo di chi ordina da ospite e
 * va all'accesso) non resta nel browser dopo l'uscita dall'account: prima passava a chi apriva la
 * cassa dopo. L'ingresso di chi la stava aspettando non la tocca.
 */

const ascolti: Array<(e: string, s: { user?: { id: string } } | null) => void> = [];
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        ascolti.push(cb as never);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => {
        ascolti.forEach((a) => a('SIGNED_OUT', null));
        return { error: null };
      },
    },
  },
}));

import QueryProvider from '@/components/providers/QueryProvider';
import { supabase } from '@/lib/supabase/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOZZA = JSON.stringify({ form: { fullName: 'Maria Rossi', phone: '3331234567', address: 'Via Roma 1' } });
const evento = (e: string, chi: string | null) => act(() => ascolti.forEach((a) => a(e, chi ? { user: { id: chi } } : null)));

let root: Root;
beforeEach(async () => {
  ascolti.length = 0;
  localStorage.clear();
  sessionStorage.clear();
  const c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(QueryProvider, null, null)));
});
afterEach(async () => { await act(async () => root.unmount()); });

describe('R01-012 · la bozza della cassa se ne va all uscita dall account', () => {
  it('«Esci»: la bozza sparisce dalla memoria del browser e da quella della scheda', async () => {
    evento('INITIAL_SESSION', 'maria');
    localStorage.setItem('mc_checkout_draft', BOZZA);
    sessionStorage.setItem('mc_checkout_draft', BOZZA);
    await act(async () => { await supabase.auth.signOut(); });
    expect(localStorage.getItem('mc_checkout_draft')).toBeNull();
    expect(sessionStorage.getItem('mc_checkout_draft')).toBeNull();
  });

  it('sessione finita da sola (SIGNED_OUT senza «Esci»): la bozza sparisce lo stesso', () => {
    evento('INITIAL_SESSION', 'maria');
    localStorage.setItem('mc_checkout_draft', BOZZA);
    evento('SIGNED_OUT', null);
    expect(localStorage.getItem('mc_checkout_draft')).toBeNull();
  });

  it('chi ordina da ospite e poi entra ritrova la sua bozza: l ingresso non la tocca', () => {
    evento('INITIAL_SESSION', null);
    localStorage.setItem('mc_checkout_draft', BOZZA);
    evento('SIGNED_IN', 'maria');
    expect(localStorage.getItem('mc_checkout_draft')).toBe(BOZZA);
  });

  it('le altre chiavi del browser non si toccano', () => {
    evento('INITIAL_SESSION', 'maria');
    localStorage.setItem('mc_checkout_draft', BOZZA);
    localStorage.setItem('altra-chiave', 'resta');
    evento('SIGNED_OUT', null);
    expect(localStorage.getItem('altra-chiave')).toBe('resta');
  });
});
