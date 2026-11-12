// @vitest-environment jsdom
/**
 * R06-023 (12/11/2026) — LA CONFIGURAZIONE CHE MANCA SI VEDE NEL PANNELLO ADMIN.
 *
 * La pagina pubblica «Stato servizi» non elenca piu' le variabili mancanti e la
 * chiave di servizio assente: il dettaglio sta nella Panoramica, solo per l'admin,
 * letto da /api/admin/configurazione.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna, type Domanda } from './aiuti/cabina-admin';

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next/navigation', () => ({ useParams: () => ({}), useRouter: () => ({ push: () => {} }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('@/components/admin/RimborsiDaDividere', () => ({ RimborsiDaDividere: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({ withAdminAuth: (h: (c: unknown) => unknown) => (req: Request) => h({ req, user: { id: 'admin-1' } }) }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function panoramica(configurazione: unknown, stato = 200) {
  fake.rispondi = (q: Domanda) =>
    q.op === 'rpc' && q.tabella === 'admin_kpi'
      ? { data: { ordini_totali: 0, ordini_per_stato: {}, incassato_cents: 0 }, error: null }
      : { data: [], error: null };
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    String(url).includes('/api/admin/configurazione')
      ? new Response(JSON.stringify({ data: configurazione }), { status: stato })
      : new Response('{}', { status: 200 })));
  const mod = (await import('@/app/admin/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('R06-023 · la Panoramica dice cosa manca nella configurazione', () => {
  it('chiave di servizio assente e titolare incompleto: lo dice, con i nomi dei dati', async () => {
    const host = await panoramica({ chiaveDiServizio: false, titolareCompleto: false, titolareMancanti: 'Mancano nelle variabili del progetto: PEC, partita IVA.' });
    const testo = host.textContent ?? '';
    expect(testo, 'Il dettaglio tolto dalla pagina pubblica non si vedeva da nessuna parte').toContain('Configurazione da completare');
    expect(testo).toContain('Chiave di servizio di Supabase non configurata');
    expect(testo).toContain('PEC, partita IVA');
  });

  it('tutto configurato: niente riquadro', async () => {
    const host = await panoramica({ chiaveDiServizio: true, titolareCompleto: true, titolareMancanti: null });
    expect(host.textContent ?? '').not.toContain('Configurazione da completare');
  });

  it('lettura caduta: niente riquadro inventato', async () => {
    const host = await panoramica(null, 500);
    expect(host.textContent ?? '').not.toContain('Configurazione da completare');
  });
});

describe('R06-023 · GET /api/admin/configurazione', () => {
  it('dice solo «c\'e\' / manca» e i nomi dei dati, mai un valore', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_valore_segreto');
    const { GET } = await import('@/app/api/admin/configurazione/route');
    const r = await (GET as unknown as (req: Request) => Promise<Response>)(new Request('https://mycity.test/api/admin/configurazione'));
    const corpo = await r.text();
    expect(r.status).toBe(200);
    expect(JSON.parse(corpo).data.chiaveDiServizio).toBe(true);
    expect(corpo).not.toContain('sb_secret_valore_segreto');
  });
});
