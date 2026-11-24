/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { accendi } from './aiuti/schermo';
import { testoVisibile } from './aiuti/monta-componente';

/**
 * R07-001 — Nel profilo del fattorino il documento d'identità non è «Verificato» appena caricato.
 *
 * Il fattorino non ancora approvato lo vedeva già «in verifica». Restava chi è già approvato: se carica
 * un documento nuovo da «Documenti e verifica», la rotta del caricamento azzera lo stato della verifica
 * (kyc_provider_status), e un nuovo invio la fa ripartire dopo l'approvazione. Nessuno ha guardato il
 * documento nuovo, ma la pagina guardava solo is_approved e diceva «Verificato».
 *
 * Il database finto risponde come PostgREST: solo le colonne chieste nella select.
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
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'marco@example.com' } }, error: null }) },
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
  vi.setSystemTime(new Date('2026-11-24T09:00:00Z'));
});
afterEach(() => vi.useRealTimers());

async function rigaDelDocumento(profilo: Record<string, unknown>) {
  stato.profilo = profilo;
  const { default: Pagina } = await import('@/app/rider/profile/page');
  const s = accendi(conQuery(Pagina as ComponentType));
  await aspetta();
  const el = Array.from(s.radice.querySelectorAll('p')).find((p) => p.textContent === 'Documento identità')?.closest('div.rounded-lg');
  const testo = el ? testoVisibile(el as HTMLElement) : '';
  s.smonta();
  return testo;
}

// Marco: inviato il 10/11, approvato dallo staff l'11/11.
// Il percorso del file porta l'ora del caricamento (`{userId}/{kind}-{Date.now()}.{ext}`, app/api/kyc/upload-document).
const NUOVO_DOPO = `u-1/id_front-${Date.parse('2026-11-23T19:58:00Z')}.jpg`;
const APPROVATO = {
  id: 'u-1', full_name: 'Marco Verdi', phone: '333', rider_vehicle_type: 'BIKE',
  rider_license_expires_on: null, rider_insurance_expires_on: null, rider_haccp_expires_on: null,
  is_approved: true, approved_at: '2026-11-11T15:00:00+00:00',
  kyc_id_doc_front_url: 'u-1/id_front-1762760000000.jpg',
  kyc_provider_status: 'PENDING', kyc_provider_checked_at: '2026-11-10T18:00:00+00:00',
};

describe('R07-001 · il documento d identità caricato dopo l approvazione non è «Verificato»', () => {
  it('approvato dopo la verifica del documento: «Verificato»', async () => {
    const testo = await rigaDelDocumento(APPROVATO);
    expect(testo).toContain('Verificato');
  });

  it('approvato, carica un documento nuovo (la rotta azzera lo stato della verifica): «In verifica», non «Verificato»', async () => {
    const testo = await rigaDelDocumento({
      ...APPROVATO, kyc_id_doc_front_url: NUOVO_DOPO, kyc_provider_status: null,
    });
    expect(testo, 'il documento appena caricato risulta già verificato').not.toContain('Verificato');
    expect(testo).toContain('In verifica');
  });

  it('approvato, carica un documento nuovo e lo rimanda in verifica dopo l approvazione: «In verifica»', async () => {
    const testo = await rigaDelDocumento({
      ...APPROVATO, kyc_id_doc_front_url: NUOVO_DOPO,
      kyc_provider_status: 'PENDING', kyc_provider_checked_at: '2026-11-23T20:00:00+00:00',
    });
    expect(testo, 'il documento rimandato in verifica risulta già verificato').not.toContain('Verificato');
    expect(testo).toContain('In verifica');
  });

  it('approvato senza nessuna verifica registrata (profilo di prima): resta «Verificato», come prima', async () => {
    const testo = await rigaDelDocumento({ ...APPROVATO, kyc_provider_status: null, kyc_provider_checked_at: null });
    expect(testo).toContain('Verificato');
  });

  // Giro di correzione: i tre casi trovati dal revisore.
  it('approvato senza nessuna verifica registrata, carica un documento nuovo dopo l approvazione: «In verifica», non «Verificato»', async () => {
    const testo = await rigaDelDocumento({
      ...APPROVATO, kyc_id_doc_front_url: NUOVO_DOPO, kyc_provider_status: null, kyc_provider_checked_at: null,
    });
    expect(testo, 'il documento appena caricato risulta già verificato').not.toContain('Verificato');
    expect(testo).toContain('In verifica');
  });

  it('sostituisce il documento mentre è in attesa (stato azzerato) e poi viene approvato: «Verificato», non in attesa per sempre', async () => {
    const testo = await rigaDelDocumento({
      ...APPROVATO, kyc_id_doc_front_url: `u-1/id_front-${Date.parse('2026-11-11T10:00:00Z')}.jpg`,
      kyc_provider_status: null, kyc_provider_checked_at: '2026-11-10T18:00:00+00:00',
    });
    expect(testo, 'il documento approvato dallo staff resta «In verifica»').toContain('Verificato');
    expect(testo).not.toContain('In verifica');
  });

  it('sostituisce il documento da approvato, poi è sospeso e riattivato (approved_at nuovo, stato vuoto): «Verificato»', async () => {
    const testo = await rigaDelDocumento({
      ...APPROVATO, approved_at: '2026-11-22T09:00:00+00:00',
      kyc_id_doc_front_url: `u-1/id_front-${Date.parse('2026-11-20T10:00:00Z')}.jpg`,
      kyc_provider_status: null, kyc_provider_checked_at: '2026-11-10T18:00:00+00:00',
    });
    expect(testo, 'il documento visto alla riattivazione resta «In verifica»').toContain('Verificato');
    expect(testo).not.toContain('In verifica');
  });

  it('documento nuovo dopo l approvazione, controllo partito dopo il caricamento ed esito APPROVED: «Verificato»', async () => {
    const testo = await rigaDelDocumento({
      ...APPROVATO, kyc_id_doc_front_url: NUOVO_DOPO,
      kyc_provider_status: 'APPROVED', kyc_provider_checked_at: '2026-11-23T20:00:00+00:00',
    });
    expect(testo, 'il documento approvato dal controllo resta «In verifica»').toContain('Verificato');
    expect(testo).not.toContain('In verifica');
  });
});
