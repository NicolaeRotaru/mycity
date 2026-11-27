/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { accendi } from './aiuti/schermo';
import { testoVisibile } from './aiuti/monta-componente';

/**
 * R16-004 / R16-005 — Profilo del fattorino, documenti.
 *  - Da approvato, l'attestato HACCP appena caricato non passa a «Caricato · OK»: nessuno l'ha guardato.
 *  - Il fattorino respinto o sospeso non legge «In attesa di verifica»: nessuno lo sta esaminando.
 *
 * Il database finto risponde come PostgREST: solo le colonne chieste nella
 * select, così un file che la pagina non legge non le arriva.
 */

const stato: { profilo: Record<string, unknown> } = { profilo: {} };

function costruttore(tabella: string) {
  let colonne: string[] | null = null;
  const esito = () => {
    if (tabella !== 'profiles') return { data: [], error: null };
    const riga = colonne
      ? Object.fromEntries(colonne.filter((c) => c in stato.profilo).map((c) => [c, stato.profilo[c]]))
      : stato.profilo;
    return { data: riga, error: null };
  };
  const q: Record<string, unknown> = {};
  q.select = (s?: string) => {
    if (typeof s === 'string' && s.trim() !== '*') colonne = s.split(',').map((c) => c.trim()).filter(Boolean);
    return q;
  };
  for (const m of ['eq', 'neq', 'order', 'limit', 'or', 'in', 'gte', 'lte']) q[m] = () => q;
  q.single = async () => esito();
  q.maybeSingle = q.single;
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esito()).then(ok, ko);
  return q;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'giulia@example.com' } }, error: null }) },
    from: (t: string) => costruttore(t),
  },
}));
vi.mock('next/navigation', () => {
  const rotta = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} };
  return { useRouter: () => rotta };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: function Collegamento({ href, children, ...resto }: { href: unknown; children?: unknown } & Record<string, unknown>) {
      return ce('a', { ...resto, href: String(href) }, children as never);
    },
  };
});
vi.mock('next-intl', () => ({ useTranslations: () => (chiave: string) => chiave }));
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} } }));
vi.mock('@/components/PushNotificationOptIn', () => ({ default: () => null }));

async function aspetta() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

function conQuery(Pagina: ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Avvolta() {
    return createElement(QueryClientProvider, { client }, createElement(Pagina));
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T09:00:00Z'));
});
afterEach(() => vi.useRealTimers());

/** Il testo della riga del documento e se ha il pulsante «Carica». */
async function riga(profilo: Record<string, unknown>, etichetta: string) {
  stato.profilo = profilo;
  const { default: Pagina } = await import('@/app/rider/profile/page');
  const s = accendi(conQuery(Pagina as ComponentType));
  await aspetta();
  const el = Array.from(s.radice.querySelectorAll('p')).find((p) => p.textContent === etichetta)?.closest('div.rounded-lg');
  const testo = el ? testoVisibile(el as HTMLElement) : '';
  const carica = !!el?.querySelector('a[href="/rider/onboarding"]');
  s.smonta();
  return { testo, carica };
}

const BASE = {
  id: 'u-1', full_name: 'Giulia Bianchi', phone: '333', rider_vehicle_type: 'BIKE',
  rider_license_expires_on: null, rider_insurance_expires_on: null, rider_haccp_expires_on: null,
};

describe('R16-004 · l attestato HACCP appena caricato non passa a «ok» da approvato', () => {
  it('fattorino approvato, HACCP caricato: resta «In verifica»', async () => {
    const { testo } = await riga({ ...BASE, is_approved: true, approval_status: 'approved', rider_haccp_url: 'u-1/rider_haccp-1.pdf' }, 'Attestato HACCP');
    expect(testo).toContain('In verifica');
    expect(testo).not.toMatch(/\bOK\b/);
  });

  it('il documento d identità, da approvato, resta «Verificato»', async () => {
    const { testo } = await riga({ ...BASE, is_approved: true, approval_status: 'approved', kyc_id_doc_front_url: 'u-1/id_front-1.jpg' }, 'Documento identità');
    expect(testo).toContain('Verificato');
  });
});

describe('R16-005 · il fattorino respinto o sospeso non legge «in attesa di verifica»', () => {
  it.each([
    ['rejected', 'respinta'],
    ['suspended', 'sospeso'],
  ])('%s: documento d identità e HACCP lo dicono', async (approval_status, parola) => {
    const p = { ...BASE, is_approved: false, approval_status, kyc_id_doc_front_url: 'u-1/id.jpg', rider_haccp_url: 'u-1/h.pdf' };
    for (const et of ['Documento identità', 'Attestato HACCP']) {
      const { testo } = await riga(p, et);
      expect(testo, et).not.toContain('In attesa di verifica');
      expect(testo, et).not.toContain('In verifica');
      expect(testo, et).toContain(parola);
    }
  });

  it('chi aspetta davvero l esame (pending) legge ancora «In attesa di verifica»', async () => {
    const { testo } = await riga({ ...BASE, is_approved: false, approval_status: 'pending', kyc_id_doc_front_url: 'u-1/id.jpg' }, 'Documento identità');
    expect(testo).toContain('In attesa di verifica');
  });
});
