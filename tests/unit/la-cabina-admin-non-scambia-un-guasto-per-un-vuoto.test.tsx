// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna, aspetta, type Domanda } from './aiuti/cabina-admin';

/**
 * 31/10/2026 — DUE PAGINE DELLA CABINA ADMIN NON DISTINGUEVANO UN GUASTO DA UN VUOTO.
 *
 * ① `/admin/orders` leggeva con `const { data: orders = [], isLoading }`: il `= []` trasformava una
 *    lettura caduta in «0 ordini · Nessun ordine», identico a un giorno senza ordini. Nessun avviso,
 *    nessun «Riprova». È la forma già tolta da `admin/coupons` e `admin/sponsored`.
 * ② `/admin` (il cruscotto) faceva `if (isLoading || !stats) return <LoadingState />`: quando
 *    `admin_kpi` cade, `isLoading` torna falso ma `stats` resta vuoto, e la pagina restava sullo
 *    scheletro per sempre. La stessa riga già riparata sul cruscotto del negoziante.
 *
 * Le prove APRONO le pagine vere in un browser finto, col database finto che risponde «errore»:
 * guardano quello che vede l'amministratore, non il testo del codice.
 * ⚪ Da qui non apro il pannello nel browser vero: verifico cosa esce a schermo in jsdom.
 */

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...resto }: { href: string; children?: ReactNode }) =>
    createElement('a', { href, ...resto }, children),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({}), useRouter: () => ({ push: () => {}, back: () => {} }) }));
// Le pagine sotto un NextIntlClientProvider: qui la frase è la sua chiave.
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('@/components/admin/RimborsiDaDividere', () => ({ RimborsiDaDividere: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const GUASTO = { message: 'connessione caduta', code: 'PGRST000' };
let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

async function apri(percorso: string): Promise<HTMLElement> {
  const mod = (await import(percorso)) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('elenco ordini: una lettura caduta non è «nessun ordine»', () => {
  it('dice che non è riuscito a leggere, e offre «Riprova»', async () => {
    fake.rispondi = (q: Domanda) => (q.tabella === 'orders' ? { data: null, error: GUASTO } : { data: [], error: null });
    const host = await apri('@/app/admin/orders/page');
    expect(host.textContent, 'una lettura caduta non può dire «0 ordini»').not.toMatch(/\b0 ordini/);
    expect(host.textContent).not.toMatch(/Nessun ordine/);
    const avviso = host.querySelector('[role="alert"]');
    expect(avviso, 'serve un avviso che dica che la lettura è caduta').not.toBeNull();
    const riprova = avviso?.querySelector('button');
    expect(riprova, 'serve un «Riprova»').not.toBeNull();

    // «Riprova» rilegge davvero, e quando il database risponde la tabella torna.
    const prima = fake.domande.filter((d) => d.tabella === 'orders').length;
    fake.rispondi = () => ({ data: [], error: null });
    riprova?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await aspetta();
    expect(fake.domande.filter((d) => d.tabella === 'orders').length).toBeGreaterThan(prima);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('una lettura riuscita e vuota lo dice con la frase delle tabelle sorelle', async () => {
    fake.rispondi = () => ({ data: [], error: null });
    const host = await apri('@/app/admin/orders/page');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain('Nessun ordine.');
  });
});

describe('cruscotto admin: se i numeri non arrivano, lo dice', () => {
  it('admin_kpi caduto → avviso con «Riprova», non lo scheletro per sempre', async () => {
    fake.rispondi = (q: Domanda) =>
      q.op === 'rpc' && q.tabella === 'admin_kpi' ? { data: null, error: GUASTO } : { data: [], error: null };
    const host = await apri('@/app/admin/page');
    const avviso = host.querySelector('[role="alert"]');
    expect(avviso, 'la pagina è rimasta sullo scheletro: nessun avviso, nessun «Riprova»').not.toBeNull();
    const riprova = avviso?.querySelector('button');
    expect(riprova).not.toBeNull();

    const prima = fake.domande.filter((d) => d.tabella === 'admin_kpi').length;
    riprova?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await aspetta();
    expect(fake.domande.filter((d) => d.tabella === 'admin_kpi').length, '«Riprova» deve rileggere').toBeGreaterThan(prima);
  });
});
