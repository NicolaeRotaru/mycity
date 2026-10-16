/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import type { FintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getCurrentUser: async () => ({ id: 'giulia' }),
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/captcha', () => ({ verifyTurnstileToken: async () => ({ ok: true, skipped: true }) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown) =>
    async (req: Request) => h({ user: { id: 'nicola' }, req, params: {} }),
}));

import { POST as scriviAiContatti } from '@/app/api/contact/route';
import { GET as lista, POST as comandoDellaLista } from '@/app/api/admin/rimborsi-da-bonificare/route';
import { cosaDiceLaVoce, type VoceDaBonificare } from '@/lib/rimborsi/bonifici-da-fare';

/**
 * Riesame del 16/10, sesto giro — L'IBAN DI UN RESO ANCORA APERTO.
 *
 * Giulia ha un reso aperto su un ordine pagato in contanti, senza aver scelto come riavere i soldi.
 * Chiede di cancellare l'account: la cancellazione aspetta, e Giulia manda subito il suo IBAN dalla
 * pagina Contatti. Su un reso aperto l'IBAN un posto non ce l'ha: la rotta che lo salva risponde
 * 409. E' una scelta (la strada piu' semplice, che si puo' cambiare senza toccare niente): l'IBAN si
 * scrive quando il reso e' rimborsato e la voce compare nella lista. Il difetto era che, a quel
 * punto, la voce diceva solo «l'email di rimborso glielo chiede»: chi paga glielo chiedeva una
 * seconda volta, e l'IBAN gia' mandato restava dove nessuno lo cercava.
 *
 * Adesso la voce dice dove arrivano i messaggi dei Contatti — in Supporto, anche quelli di prima del
 * rimborso — e la prova controlla che sia vero: il messaggio di Giulia arriva davvero li', la voce
 * del menu c'e', e la pagina Supporto lo mostra.
 */

const ORDINE = '11111111-1111-4111-8111-111111111111';
const RESO = '22222222-2222-4222-8222-222222222222';
const IBAN = 'IT60X0542811101000000123456';
const SEGNO = `bonifico:4000:return_${RESO}`;
const globale = globalThis as Record<string, unknown>;

let Menu: ComponentType<Record<string, unknown>>;
let Supporto: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  Menu = (await monta('components/admin/AdminSidebar.tsx')).default as ComponentType<Record<string, unknown>>;
  Supporto = (await monta('app/admin/support/page.tsx')).default as ComponentType<Record<string, unknown>>;
}, 120000);

beforeEach(() => {
  finto.db = creaFintoDatabase({
    orders: [{ id: ORDINE, user_id: 'giulia', payment_method: 'cod', stripe_refund_id: null }],
    returns: [{
      id: RESO, order_id: ORDINE, buyer_id: 'giulia', status: 'APPROVED', refund_id: null, refund_method: null,
      refund_iban: null, refund_intestatario: null, refund_bonifico_cents: null, refund_bonifico_fatto_at: null,
      refund_amount_cents: 4000, refunded_at: null,
    }],
    bonifici_dei_reclami: [],
    contact_messages: [],
  });
});

afterEach(() => {
  delete globale.__DATI_QUERY__;
  delete globale.__MUTAZIONI__;
  delete globale.__PERCORSO_FINTO__;
  delete globale.__PROFILO__;
});

const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

async function salvaLIban() {
  const res = await (comandoDellaLista as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/admin/rimborsi-da-bonificare', json({ resoId: RESO, azione: 'iban', iban: IBAN })),
  );
  return res.status;
}

describe('l IBAN mandato col reso ancora aperto si ritrova quando il bonifico compare', () => {
  it('IL CASO CHE ROMPEVA — la voce senza IBAN dice dove arriva il messaggio di Giulia, ed e vero', async () => {
    // ① Reso aperto: Giulia manda l'IBAN dai Contatti. Il messaggio arriva.
    const inviato = await (scriviAiContatti as unknown as (r: Request) => Promise<Response>)(
      new Request('http://localhost/api/contact', json({
        name: 'Giulia Verdi', email: 'giulia@example.com', subject: 'IBAN per il rimborso',
        message: `Ecco il mio IBAN per il reso dell'ordine #11111111: ${IBAN}`,
      })),
    );
    expect(inviato.status).toBe(200);
    expect(finto.db.tabelle.contact_messages, 'il messaggio non e arrivato: la prova non misura niente').toHaveLength(1);

    // ② Su un reso aperto l'IBAN non si salva: la strada scelta, che resta com'era.
    expect(await salvaLIban()).toBe(409);
    expect(finto.db.tabelle.returns[0].refund_iban ?? null).toBeNull();

    // ③ Il negozio rimborsa: il server scrive il segno sull'ordine. La voce compare, senza IBAN.
    finto.db.tabelle.orders[0].stripe_refund_id = SEGNO;
    Object.assign(finto.db.tabelle.returns[0], { status: 'REFUNDED', refund_id: SEGNO, refund_bonifico_cents: 4000 });
    const res = await (lista as unknown as (r: Request) => Promise<Response>)(new Request('http://localhost/api/admin/rimborsi-da-bonificare'));
    const corpo = (await res.json()) as { voci: VoceDaBonificare[]; migrazione162: boolean };
    const [voce] = corpo.voci;
    expect(voce).toMatchObject({ id: RESO, iban: null, daFare: true });

    // ④ La voce dice dove guardare: la voce del menu con quel nome c'e', e porta a Supporto.
    const frase = cosaDiceLaVoce(voce, corpo.migrazione162).alPostoDellIban ?? '';
    globale.__PERCORSO_FINTO__ = '/admin/rimborsi-da-bonificare';
    const menu = accendi(Menu);
    const supportoNelMenu = Array.from(menu.radice.querySelectorAll('nav a[href]')).find(
      (a) => a.getAttribute('href') === '/admin/support',
    );
    const nomeNelMenu = testoVisibile(supportoNelMenu ?? null).trim();
    menu.smonta();
    expect(nomeNelMenu, 'nel menu non c e la pagina dei messaggi dei Contatti').not.toBe('');
    expect(frase, `la voce non dice dove arrivano i messaggi dei Contatti («${nomeNelMenu}»)`).toContain(nomeNelMenu);
    expect(frase).toMatch(/di prima del rimborso/u);

    // ⑤ E li', fra i messaggi, c'e' l'IBAN di Giulia.
    globale.__DATI_QUERY__ = finto.db.tabelle.contact_messages.map((m, i) => ({
      id: `m${i}`, status: 'new', created_at: '2026-10-14T10:00:00Z', admin_notes: null, ...m,
    }));
    const pagina = accendi(Supporto);
    expect(testoVisibile(pagina.radice), 'la pagina Supporto non mostra il messaggio con l IBAN').toContain(IBAN);
    pagina.smonta();

    // ⑥ Chi paga lo copia sulla voce.
    expect(await salvaLIban()).toBe(200);
    expect(finto.db.tabelle.returns[0].refund_iban).toBe(IBAN);
  }, 120000);
});
