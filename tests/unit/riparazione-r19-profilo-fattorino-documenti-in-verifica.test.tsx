/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { accendi } from './aiuti/schermo';
import { testoVisibile } from './aiuti/monta-componente';

/**
 * R19-005 — Nel profilo del fattorino un documento appena caricato non è né
 * «Verificato» né «In scadenza»: è in verifica. E l'attestato HACCP caricato
 * non resta «Mancante» col pulsante rosso «Carica»: la sua scadenza non la
 * scrive nessuno, quindi si riconosce dal file.
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

describe('R19-005 · documenti del fattorino: caricato vuol dire «in verifica», e l HACCP caricato si vede', () => {
  it('documento d identità appena caricato, fattorino non approvato: «In verifica», né «Verificato» né «In scadenza»', async () => {
    const { testo } = await riga({ ...BASE, is_approved: false, kyc_id_doc_front_url: 'u-1/id_front-1.jpg' }, 'Documento identità');
    expect(testo).toContain('In verifica');
    expect(testo).not.toContain('Verificato');
    expect(testo, 'un documento in esame si presenta come «In scadenza»').not.toContain('In scadenza');
  });

  it('attestato HACCP caricato, fattorino non approvato: «In verifica», non «Mancante» col pulsante «Carica»', async () => {
    const { testo, carica } = await riga({ ...BASE, is_approved: false, rider_haccp_url: 'u-1/rider_haccp-1.pdf' }, 'Attestato HACCP');
    expect(testo).not.toContain('Mancante');
    expect(carica, 'l attestato caricato ha ancora il pulsante rosso «Carica»').toBe(false);
    expect(testo).toContain('In verifica');
  });

  it('attestato HACCP caricato, fattorino approvato: «Caricato», non «Mancante»', async () => {
    const { testo, carica } = await riga({ ...BASE, is_approved: true, rider_haccp_url: 'u-1/rider_haccp-1.pdf' }, 'Attestato HACCP');
    expect(testo).toContain('Caricato');
    expect(testo).not.toContain('Mancante');
    expect(carica).toBe(false);
  });

  it('attestato HACCP non caricato: resta facoltativo da caricare, come prima', async () => {
    const { testo, carica } = await riga({ ...BASE, is_approved: true }, 'Attestato HACCP');
    expect(testo).toContain('Facoltativo');
    expect(carica).toBe(true);
  });
});
