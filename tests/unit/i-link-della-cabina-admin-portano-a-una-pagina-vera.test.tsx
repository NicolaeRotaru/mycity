// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna, aspetta, scrivi, paginaPer, type Domanda } from './aiuti/cabina-admin';

/**
 * 31/10/2026 — DUE LINK DELLA CABINA ADMIN PORTAVANO A «PAGINA NON TROVATA».
 *
 * ① `/admin/orders/<id>`: lo linkano l'elenco ordini, «Oggi», i bonifici e ogni allarme
 *    automatico agli amministratori. La pagina non esisteva: l'allarme «ordine fermo» portava
 *    a un 404, e l'unica cosa che si poteva fare su un ordine era «Annulla».
 * ② `/admin/segnalazioni`: ogni segnalazione di contenuto illecito (DSA) avvisa gli
 *    amministratori con quel link. La pagina non esisteva: le segnalazioni finivano in un
 *    archivio che nessuno poteva aprire, quindi nessuna poteva essere esaminata né chiusa con
 *    una decisione motivata.
 *
 * Le prove prendono il link DA DOVE NASCE (la tabella degli ordini disegnata; l'avviso scritto
 * dalla rotta delle segnalazioni), cercano in `app/` la pagina che Next.js aprirebbe, la aprono
 * e guardano cosa vede l'amministratore.
 * ⚪ Non provo il browser vero né il database vero: la regola del database «solo
 * l'amministrazione decide» la simulo, rispondendo zero righe aggiornate.
 */

const nav = vi.hoisted(() => ({ params: {} as Record<string, string> }));
vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('@/lib/supabase/server', async () => {
  const { fake: f } = await import('./aiuti/cabina-admin');
  return {
    getAdminSupabase: () => f,
    getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  };
});
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }),
  getClientIp: () => '203.0.113.7',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...resto }: { href: string; children?: ReactNode }) =>
    createElement('a', { href, ...resto }, children),
}));
vi.mock('next/navigation', () => ({ useParams: () => nav.params, useRouter: () => ({ push: () => {}, back: () => {} }) }));
// Le pagine sotto un NextIntlClientProvider: qui la frase è la sua chiave.
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('@/components/admin/RimborsiDaDividere', () => ({ RimborsiDaDividere: () => null }));
const avvisi = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: avvisi }));

const ID = '11111111-2222-4333-8444-555555555555';
const ORDINE = {
  id: ID, user_id: 'u1', seller_id: 's1', rider_id: null, total_price: 23.5, shipping_cost: 3,
  discount_amount: 0, coupon_code: null, payment_method: 'card', payment_status: 'paid',
  delivery_status: 'NEW', pickup_in_store: false, delivery_slot: null, created_at: '2026-10-30T10:00:00Z',
  accepted_at: null, ready_at: null, picked_up_at: null, delivered_at: null, canceled_at: null,
  delivery_full_name: 'Maria Rossi', delivery_phone: '3330000000', delivery_address: 'Via Roma 1',
  delivery_city: 'Piacenza', delivery_zip: '29121', delivery_notes: null, refunded_amount_cents: 0,
  payout_status: 'pending', dispute_status: null,
  seller: { store_name: 'Pane Quotidiano' }, rider: null,
  order_items: [{ id: 'r1', quantity: 2, unit_price: 10.25, product_name: 'Focaccia' }],
};

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); nav.params = {}; vi.clearAllMocks(); });

async function apriIndirizzo(indirizzo: string): Promise<HTMLElement> {
  const pagina = paginaPer(indirizzo);
  expect(pagina, `«${indirizzo}» porta a «pagina non trovata»: in app/ non c'è la pagina`).not.toBeNull();
  nav.params = pagina!.params;
  const mod = (await import(/* @vite-ignore */ pagina!.file)) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('il link «ordine» dell\'elenco apre il dettaglio dell\'ordine', () => {
  it('dalla tabella al dettaglio: si vedono negozio, cliente, articoli e totale', async () => {
    fake.rispondi = (q: Domanda) =>
      q.tabella === 'orders' && q.una ? { data: ORDINE, error: null }
        : q.tabella === 'orders' ? { data: [ORDINE], error: null }
          : { data: [], error: null };
    const lista = await import('@/app/admin/orders/page');
    const r = await disegna(createElement(lista.default));
    const link = [...r.host.querySelectorAll('a')].map((a) => a.getAttribute('href')).find((h) => h?.includes(ID));
    r.chiudi();
    expect(link).toBe(`/admin/orders/${ID}`);

    const host = await apriIndirizzo(link!);
    const testo = host.textContent ?? '';
    expect(testo).toContain('#111111');
    expect(testo).toContain('Pane Quotidiano');
    expect(testo).toContain('Maria Rossi');
    expect(testo).toContain('Focaccia');
    expect(fake.domande.some((d) => d.tabella === 'orders' && d.una && d.filtri.id === ID)).toBe(true);
  });

  it('lettura caduta: avviso con «Riprova», non «ordine non trovato»', async () => {
    fake.rispondi = () => ({ data: null, error: { message: 'connessione caduta' } });
    const host = await apriIndirizzo(`/admin/orders/${ID}`);
    expect(host.querySelector('[role="alert"] button')).not.toBeNull();
    expect(host.textContent).not.toMatch(/non trovato/i);
  });

  it('ordine che non c\'è: lo dice, senza fingere un guasto', async () => {
    fake.rispondi = () => ({ data: null, error: null });
    const host = await apriIndirizzo(`/admin/orders/${ID}`);
    expect(host.textContent).toMatch(/Ordine non trovato/);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('l\'avviso di una segnalazione apre una pagina dove si esamina e si decide', () => {
  const SEGNALAZIONE = {
    id: '99999999-2222-4333-8444-555555555555', tipo: 'prodotto', oggetto_id: ID, motivo: 'contraffatto',
    dettaglio: 'Borsa con marchio falso', email_contatto: 'chi@segnala.it', segnalante_id: null,
    stato: 'ricevuta', esito_motivato: null, deciso_at: null, created_at: '2026-10-30T09:00:00Z',
  };

  async function linkDellAvviso(): Promise<string> {
    const notifiche: unknown[] = [];
    fake.rispondi = (q: Domanda) => {
      if (q.tabella === 'segnalazioni' && q.op === 'insert') return { data: { id: SEGNALAZIONE.id }, error: null };
      if (q.tabella === 'profiles') return { data: [{ id: 'admin-1' }], error: null };
      if (q.tabella === 'notifications') { notifiche.push(...(q.valori as unknown[])); return { data: null, error: null }; }
      return { data: [], error: null };
    };
    const { POST } = await import('@/app/api/segnalazioni/route');
    const res = await POST(new Request('http://cabina.test/api/segnalazioni', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'prodotto', oggettoId: ID, motivo: 'contraffatto', dettaglio: 'Borsa con marchio falso' }),
    }) as never);
    expect(res.status).toBe(201);
    const link = (notifiche[0] as { link?: string } | undefined)?.link;
    expect(link, 'la rotta deve avvisare gli amministratori con un link').toBeTruthy();
    fake.azzera();
    return link!;
  }

  function rispondiCon(aggiornate: unknown[]) {
    fake.rispondi = (q: Domanda) =>
      q.tabella === 'segnalazioni' && q.op === 'update' ? { data: aggiornate, error: null }
        : q.tabella === 'segnalazioni' ? { data: [SEGNALAZIONE], error: null }
          : { data: [], error: null };
  }

  it('la segnalazione si vede, e «respinta» pretende una motivazione prima di registrarsi', async () => {
    const link = await linkDellAvviso();
    rispondiCon([{ id: SEGNALAZIONE.id }]);
    const host = await apriIndirizzo(link);
    expect(host.textContent).toContain('Borsa con marchio falso');

    const scelta = host.querySelector('select') as HTMLSelectElement;
    const motivo = host.querySelector('textarea') as HTMLTextAreaElement;
    const invia = host.querySelector('form button[type="submit"]') as HTMLButtonElement;
    await scrivi(scelta, 'respinta');
    await scrivi(motivo, 'no');
    expect(invia.disabled, 'una decisione senza motivazione non si registra').toBe(true);

    await scrivi(motivo, 'Il marchio è originale: il venditore ha mostrato la fattura del distributore.');
    expect(invia.disabled).toBe(false);
    invia.click();
    await aspetta();
    const scrittura = fake.domande.find((d) => d.tabella === 'segnalazioni' && d.op === 'update');
    expect(scrittura?.filtri.id).toBe(SEGNALAZIONE.id);
    expect(scrittura?.valori).toMatchObject({ stato: 'respinta', esito_motivato: expect.stringContaining('fattura') });
    expect(avvisi.success).toHaveBeenCalled();
  });

  it('se il database non aggiorna nessuna riga, non dice «registrata»', async () => {
    const link = await linkDellAvviso();
    rispondiCon([]);
    const host = await apriIndirizzo(link);
    await scrivi(host.querySelector('select') as HTMLSelectElement, 'accolta');
    await scrivi(host.querySelector('textarea') as HTMLTextAreaElement, 'Prodotto contraffatto: tolto dal catalogo.');
    (host.querySelector('form button[type="submit"]') as HTMLButtonElement).click();
    await aspetta();
    expect(fake.domande.some((d) => d.tabella === 'segnalazioni' && d.op === 'update')).toBe(true);
    expect(avvisi.success).not.toHaveBeenCalled();
    expect(avvisi.error).toHaveBeenCalled();
  });
});
