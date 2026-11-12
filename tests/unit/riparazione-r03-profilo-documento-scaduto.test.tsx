/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { accendi } from './aiuti/schermo';
import { testoVisibile } from './aiuti/monta-componente';

/**
 * R03-018 (parte del profilo) — Il profilo del fattorino dice «Scaduto» a un documento scaduto,
 * non «In scadenza», e non dice «Verificato» a un documento che nessuno ha ancora esaminato.
 *
 * Orologio fisso al 5/11/2026 (solo la data: i timer restano veri per react-query). La parte
 * che ferma davvero le consegne sta nel database: tests/sql/rls/riparazione-r03-scadenze-del-fattorino.test.sql.
 */

type Esito = { data: unknown; error: { message: string } | null };
type Op = { tabella: string; azione: string; valori?: unknown; filtri: Array<[string, unknown]> };
const stato: {
  esiti: Record<string, (op: Op) => Esito>;
  ops: Op[];
  toast: Array<{ tipo: string; testo: string }>;
  spinte: string[];
} = { esiti: {}, ops: [], toast: [], spinte: [] };

function costruttore(tabella: string) {
  const op: Op = { tabella, azione: 'select', filtri: [] };
  const esito = () => (stato.esiti[tabella] ?? (() => ({ data: [], error: null })))(op);
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'or']) q[m] = () => q;
  q.eq = (c: string, v: unknown) => { op.filtri.push([`eq:${c}`, v]); return q; };
  q.neq = (c: string, v: unknown) => { op.filtri.push([`neq:${c}`, v]); return q; };
  q.insert = (v: unknown) => { op.azione = 'insert'; op.valori = v; return q; };
  q.update = (v: unknown) => { op.azione = 'update'; op.valori = v; return q; };
  q.delete = () => { op.azione = 'delete'; return q; };
  q.single = async () => { stato.ops.push({ ...op }); return esito(); };
  q.maybeSingle = q.single;
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    stato.ops.push({ ...op });
    return Promise.resolve(esito()).then(ok, ko);
  };
  return q;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'anna@example.com' } }, error: null }) },
    from: (t: string) => costruttore(t),
  },
}));
vi.mock('next/navigation', () => {
  const rotta = { push: (u: string) => { stato.spinte.push(u); }, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} };
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
vi.mock('sonner', () => {
  const r = (tipo: string) => (testo: string) => { stato.toast.push({ tipo, testo }); };
  return { toast: { success: r('success'), error: r('error'), info: r('info'), warning: r('warning') } };
});
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => {}, trackReferralSent: () => {} }));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  INVITI_E_PUNTI_ACCESI: true,
  CLASSIFICA_INVITI_ACCESA: true,
}));

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

vi.mock('@/components/PushNotificationOptIn', () => ({ default: () => null }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T09:00:00Z'));
  stato.esiti = {};
  stato.ops = [];
  stato.toast = [];
});
afterEach(() => vi.useRealTimers());

async function riga(profilo: Record<string, unknown>, etichetta: string) {
  stato.esiti.profiles = (op) => (op.azione === 'select' ? { data: profilo, error: null } : { data: null, error: null });
  const { default: Pagina } = await import('@/app/rider/profile/page');
  const s = accendi(conQuery(Pagina as ComponentType));
  await aspetta();
  const el = Array.from(s.radice.querySelectorAll('p')).find((p) => p.textContent === etichetta)?.closest('div.rounded-lg');
  const testo = el ? testoVisibile(el as HTMLElement) : '';
  s.smonta();
  return testo;
}

const BASE = { id: 'u-1', full_name: 'Mario Rossi', phone: '333', rider_vehicle_type: 'SCOOTER', rider_license_expires_on: '2027-06-01' };

describe('R03-018 — il profilo dice il vero sui documenti', () => {
  it('polizza scaduta il 31/10: «Scaduto», non «In scadenza»', async () => {
    const t = await riga({ ...BASE, is_approved: true, rider_insurance_expires_on: '2026-10-31' }, 'Assicurazione RC');
    expect(t).toContain('Scadut');
    expect(t, 'un documento scaduto si presenta come «In scadenza»').not.toContain('In scadenza');
  });

  it('polizza che scade fra un mese: «In scadenza», come prima', async () => {
    const t = await riga({ ...BASE, is_approved: true, rider_insurance_expires_on: '2026-12-01' }, 'Assicurazione RC');
    expect(t).toContain('In scadenza');
  });

  it('documento caricato ma fattorino non ancora approvato: non «Verificato»', async () => {
    const t = await riga({ ...BASE, is_approved: false, kyc_id_doc_front_url: 'doc.jpg' }, 'Documento identità');
    expect(t).not.toContain('Verificato');
    expect(t).toContain('In attesa di verifica');
  });
});
