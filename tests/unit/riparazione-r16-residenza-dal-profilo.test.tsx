/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R16-010 — Indirizzo, CAP e città del profilo non si correggono più.
 *
 * Dal 5/11 il Profilo non mostra più indirizzo, CAP e città (la cassa non li usa: gli indirizzi
 * di consegna stanno nella rubrica). Ma /sell li leggeva ancora per precompilare la residenza del
 * negoziante: arrivava un indirizzo vecchio che nessuno poteva più rettificare dal Profilo.
 *
 * 25/11/2026 — Il modulo corto di /sell la residenza non la chiede più: si scrive dal Profilo del
 * negozio, nel riquadro «Dati del titolare». La regola resta la stessa e si guarda dove vive
 * adesso: la residenza si precompila SOLO con quella scritta dal negoziante (legal_residence_*),
 * mai con l'indirizzo vecchio del profilo.
 */

const stato = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  valoriDelModulo: null as Record<string, unknown> | null,
  inizialiTitolare: null as Record<string, unknown> | null,
  quandoSalvati: null as null | (() => void),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => '/seller/profile' }));
vi.mock('@/lib/supabase/client', () => {
  const lettura = () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.single = async () => ({ data: stato.profilo, error: null });
    q.maybeSingle = async () => ({ data: stato.profilo, error: null });
    return q;
  };
  return { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'n1', email: 'a@b.it' } } }) }, from: () => lettura() } };
});
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isAuthenticated: true, isLoading: false, isSeller: false }),
}));
vi.mock('@/components/SellerApplicationForm', () => ({
  default: (p: { defaultValues: Record<string, unknown> }) => {
    stato.valoriDelModulo = p.defaultValues;
    return createElement('form', { 'data-prova': 'modulo-venditore' });
  },
}));
vi.mock('@/components/seller/DatiDelTitolare', () => ({
  default: (p: { iniziali: Record<string, unknown>; quandoSalvati?: () => void }) => {
    stato.inizialiTitolare = p.iniziali;
    stato.quandoSalvati = p.quandoSalvati ?? null;
    return createElement('form', { 'data-prova': 'dati-del-titolare' });
  },
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }) }));
vi.mock('@/components/VendorForm', () => ({ default: () => null }));
vi.mock('@/components/PushNotificationOptIn', () => ({ default: () => null }));
vi.mock('@/components/seller/DatiPerIBonifici', () => ({ default: () => null }));
vi.mock('@/components/seller/GestisciAbbonamento', () => ({ default: () => null }));
vi.mock('@/components/seller/PianoNelProfilo', () => ({ default: () => null }));
vi.mock('@/components/seller/CanaliDelNegozio', () => ({ default: () => null }));

const PROFILO_VECCHIO = { address: 'Via Vecchia 1', city: 'Milano', zip: '20100' };

const accesi: Root[] = [];
beforeEach(() => {
  stato.profilo = null;
  stato.valoriDelModulo = null;
  stato.inizialiTitolare = null;
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

async function monta(modulo: '@/app/sell/page' | '@/app/seller/profile/page') {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { default: Pagina } = modulo === '@/app/sell/page' ? await import('@/app/sell/page') : await import('@/app/seller/profile/page');
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))); });
  await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
  return radice;
}

describe('R16-010 · la residenza non si precompila con l’indirizzo del profilo che non si può correggere', () => {
  it('/sell non la chiede più, e non porta nel modulo l’indirizzo vecchio', async () => {
    stato.profilo = {
      role: 'buyer', approval_status: 'pending', approval_requested_at: null,
      full_name: 'Anna Rossi', ...PROFILO_VECCHIO,
    };
    const radice = await monta('@/app/sell/page');
    expect(radice.querySelector('[data-prova="modulo-venditore"]'), 'il modulo di /sell non c’è').not.toBeNull();
    const valori = stato.valoriDelModulo ?? {};
    for (const campo of ['legalResidenceAddr', 'legalResidenceCity', 'legalResidenceZip']) {
      expect(campo in valori, `/sell manda ancora ${campo} al modulo corto`).toBe(false);
    }
    expect(JSON.stringify(valori)).not.toMatch(/Via Vecchia|Milano|20100/);
  });

  it('nel Profilo un negozio con un vecchio indirizzo trova la residenza vuota, da scrivere lui', async () => {
    stato.profilo = { id: 'n1', role: 'seller', is_approved: true, store_name: 'Forno', ...PROFILO_VECCHIO };
    const radice = await monta('@/app/seller/profile/page');
    expect(radice.querySelector('[data-prova="dati-del-titolare"]'), 'il riquadro del titolare non c’è').not.toBeNull();
    expect(stato.inizialiTitolare).toMatchObject({ legalResidenceAddr: '', legalResidenceCity: '', legalResidenceZip: '' });
  });

  it('nel Profilo la residenza già scritta dal negoziante resta precompilata', async () => {
    stato.profilo = {
      id: 'n1', role: 'seller', is_approved: true, store_name: 'Forno', ...PROFILO_VECCHIO,
      legal_residence_addr: 'Via Roma 12', legal_residence_city: 'Piacenza', legal_residence_zip: '29121',
    };
    await monta('@/app/seller/profile/page');
    expect(stato.inizialiTitolare).toMatchObject({
      legalResidenceAddr: 'Via Roma 12', legalResidenceCity: 'Piacenza', legalResidenceZip: '29121',
    });
  });

  it('la pagina «Richiesta in valutazione» chiede chi firma, precompilato solo dai dati del titolare', async () => {
    stato.profilo = {
      role: 'seller', approval_status: 'pending', approval_requested_at: '2026-11-25T08:00:00Z',
      ...PROFILO_VECCHIO,
    };
    const radice = await monta('@/app/sell/page');
    expect(radice.querySelector('[data-prova="dati-del-titolare"]'), 'la pagina d’attesa non chiede i dati del titolare').not.toBeNull();
    expect(radice.textContent).toContain('Ultimo passo');
    expect(stato.inizialiTitolare).toMatchObject({ legalResidenceAddr: '', legalResidenceCity: '', legalResidenceZip: '' });
  });

  it('salvati i dati di chi firma, la riga «Ultimo passo» sparisce', async () => {
    stato.profilo = { role: 'seller', approval_status: 'pending', approval_requested_at: '2026-11-25T08:00:00Z' };
    const radice = await monta('@/app/sell/page');
    expect(radice.textContent).toContain('Ultimo passo');
    stato.profilo = {
      ...stato.profilo,
      legal_first_name: 'Mario', legal_last_name: 'Rossi', legal_fiscal_code: 'RSSMRA80E05G535X', legal_birth_date: '1980-05-05',
    };
    expect(stato.quandoSalvati, 'il riquadro non avvisa la pagina quando ha salvato').toBeTypeOf('function');
    await act(async () => { stato.quandoSalvati!(); await new Promise((r) => setTimeout(r, 60)); });
    expect(radice.textContent, 'la pagina chiede ancora i dati appena salvati').not.toContain('Ultimo passo');
  });
});
