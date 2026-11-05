/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { accendi, clicca } from './aiuti/schermo';
import { testoVisibile } from './aiuti/monta-componente';

/**
 * S08 (5/11/2026) — Le pagine del profilo: rubrica indirizzi, gift card,
 * profilo, inviti e classifica. Il client di Supabase è finto e può fallire
 * tabella per tabella; react-query è quello vero.
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
  return { toast: { success: r('success'), error: r('error'), info: r('info') } };
});
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => {}, trackReferralSent: () => {} }));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  INVITI_E_PUNTI_ACCESI: true,
  CLASSIFICA_INVITI_ACCESA: true,
}));

const ROTTO = { data: null, error: { message: 'rete giù' } };

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
  stato.esiti = {};
  stato.ops = [];
  stato.toast = [];
  stato.spinte = [];
  (globalThis as Record<string, unknown>).fetch = async () => new Response('{}', { status: 200 });
});

describe('rubrica indirizzi (scheda 424)', () => {
  const CASA = { id: 'a-1', label: 'Casa', full_name: 'Maria', phone: '3', address: 'Via Roma 12', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, is_default: true };

  it('se il salvataggio cade non dice «Indirizzo salvato», non svuota il modulo e non toglie il predefinito agli altri', async () => {
    stato.esiti.user_addresses = (op) => (op.azione === 'select' ? { data: [CASA], error: null } : ROTTO);
    const { default: Pagina } = await import('@/app/profile/addresses/page');
    const s = accendi(conQuery(Pagina as ComponentType));
    await aspetta();
    const modifica = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).includes('edit'))!;
    s.agisci(() => clicca(modifica));
    await aspetta();
    const form = s.radice.querySelector('form')!;
    s.agisci(() => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    await aspetta();
    expect(stato.toast.map((t) => t.tipo)).not.toContain('success');
    expect(stato.toast.map((t) => t.tipo)).toContain('error');
    expect(s.radice.querySelector('form'), 'il modulo si è chiuso e svuotato').not.toBeNull();
    const tolti = stato.ops.filter((o) => o.azione === 'update' && (o.valori as { is_default?: boolean })?.is_default === false);
    expect(tolti, 'il predefinito è stato tolto agli altri prima di salvare').toHaveLength(0);
    s.smonta();
  });

  it('il predefinito si toglie agli altri solo dopo il salvataggio, e non a quello appena salvato', async () => {
    stato.esiti.user_addresses = (op) => (op.azione === 'select' ? { data: [CASA], error: null } : { data: null, error: null });
    const { default: Pagina } = await import('@/app/profile/addresses/page');
    const s = accendi(conQuery(Pagina as ComponentType));
    await aspetta();
    const modifica = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).includes('edit'))!;
    s.agisci(() => clicca(modifica));
    await aspetta();
    const form = s.radice.querySelector('form')!;
    s.agisci(() => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    await aspetta();
    const scritture = stato.ops.filter((o) => o.azione === 'update');
    expect(scritture[0].valori).toMatchObject({ address: 'Via Roma 12' });
    expect(scritture[1].valori).toEqual({ is_default: false });
    expect(scritture[1].filtri).toContainEqual(['neq:id', 'a-1']);
    expect(stato.toast.map((t) => t.tipo)).toContain('success');
    s.smonta();
  });
});

describe('gift card (schede 425 e 1835)', () => {
  it('se la lettura cade non dice «Nessuna gift card ancora» né «(0)»', async () => {
    stato.esiti.profiles = () => ({ data: { wallet_balance_cents: 0 }, error: null });
    stato.esiti.gift_cards = () => ROTTO;
    const { default: Pagina } = await import('@/app/profile/gift-cards/page');
    const s = accendi(conQuery(Pagina as ComponentType));
    await aspetta();
    const mie = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).startsWith('Le mie gift card'));
    if (mie) s.agisci(() => clicca(mie));
    await aspetta();
    const testo = testoVisibile(s.radice);
    expect(testo).not.toContain('Nessuna gift card ancora');
    expect(testo).not.toContain('Le mie gift card (0)');
    expect(testo).toContain('Non riusciamo a leggere le tue gift card');
    s.smonta();
  });

  it('le schede dicono al lettore di schermo quale è attiva', async () => {
    stato.esiti.profiles = () => ({ data: { wallet_balance_cents: 0 }, error: null });
    const { default: Pagina } = await import('@/app/profile/gift-cards/page');
    const s = accendi(conQuery(Pagina as ComponentType));
    await aspetta();
    const schede = Array.from(s.radice.querySelectorAll('[role="tab"]'));
    expect(schede.length).toBeGreaterThanOrEqual(2);
    expect(schede.filter((b) => b.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(s.radice.querySelector('[role="tablist"]')).not.toBeNull();
    s.smonta();
  });
});

describe('profilo (schede 312 e 178)', () => {
  it('una lettura caduta non manda alla pagina di accesso: dice l errore e offre Riprova', async () => {
    stato.esiti.profiles = () => ROTTO;
    const { default: Pagina } = await import('@/app/profile/page');
    const s = accendi(conQuery(Pagina as ComponentType));
    await aspetta();
    expect(stato.spinte).toEqual([]);
    expect(testoVisibile(s.radice)).toContain('Non riusciamo a caricare il tuo profilo');
    s.smonta();
  });

  it('il profilo non chiede indirizzo, CAP e città che la cassa non usa, e rimanda alla rubrica', async () => {
    stato.esiti.profiles = () => ({ data: { full_name: 'Anna', phone: '3', created_at: '2026-01-01' }, error: null });
    const { default: Pagina } = await import('@/app/profile/page');
    const s = accendi(conQuery(Pagina as ComponentType));
    await aspetta();
    const etichette = Array.from(s.radice.querySelectorAll('label')).map((l) => testoVisibile(l).trim());
    expect(etichette).not.toContain('Indirizzo');
    expect(etichette).not.toContain('CAP');
    expect(etichette).not.toContain('Città');
    expect(Array.from(s.radice.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toContain('/profile/addresses');
    s.smonta();
    const impostazioni = readFileSync(path.resolve(__dirname, '../../app/profile/settings/page.tsx'), 'utf8');
    expect(impostazioni).not.toContain('nome, telefono, indirizzo principale');
  });
});

describe('inviti e classifica (schede 1833, 1825, 2426)', () => {
  it('profilo non letto: niente rotellina infinita', async () => {
    stato.esiti.profiles = () => ROTTO;
    const { default: Pagina } = await import('@/app/profile/referral/page');
    const s = accendi(conQuery(Pagina as ComponentType));
    await aspetta();
    expect(testoVisibile(s.radice)).toContain('Non riusciamo a caricare i tuoi inviti');
    s.smonta();
  });

  it('inviti non letti: niente «0 invitati» e «€0,00 guadagnati»', async () => {
    stato.esiti.profiles = () => ({ data: { referral_code: 'ANNA1', full_name: 'Anna' }, error: null });
    stato.esiti.referrals = () => ROTTO;
    const { default: Pagina } = await import('@/app/profile/referral/page');
    const s = accendi(conQuery(Pagina as ComponentType));
    await aspetta();
    const testo = testoVisibile(s.radice);
    expect(testo).not.toMatch(/Guadagnati/);
    expect(testo).toContain('Non riusciamo a leggere i tuoi inviti');
    s.smonta();
  });

  it('classifica non letta: niente «Classifica vuota · Sii il primo»', async () => {
    stato.esiti.referral_leaderboard = () => ROTTO;
    const { default: Pagina } = await import('@/app/profile/referral/leaderboard/page');
    const s = accendi(conQuery(Pagina as ComponentType));
    await aspetta();
    const testo = testoVisibile(s.radice);
    expect(testo).not.toContain('Classifica vuota');
    expect(testo).toContain('Non riusciamo a leggere la classifica');
    s.smonta();
  });

  it('classifica spenta: non promette un credito per ogni amico', () => {
    const sorgente = readFileSync(path.resolve(__dirname, '../../app/profile/referral/leaderboard/page.tsx'), 'utf8');
    expect(sorgente).not.toContain('Il credito per ogni amico');
  });
});
