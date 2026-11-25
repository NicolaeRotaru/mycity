/**
 * @vitest-environment jsdom
 */
/**
 * 24/11/2026, sera — Nicola, sulla pagina Analisi di Pane Quotidiano: «vedi l'abbonamento a
 * sinistra? usa la tecnica di Claude, tipo lo metti nelle impostazioni però è sempre visibile in
 * qualche modo e ricorda con quale abbonamento sei».
 *
 *  · «Abbonamento» non è più una voce del gruppo Servizi;
 *  · in fondo al menu c'è il negozio col suo piano sotto il nome («Piano Business»), sempre in vista;
 *  · un clic apre il menu dell'account: l'abbonamento, il Profilo e impostazioni, il marketplace, Esci;
 *  · un pagamento non riuscito si vede già sotto il nome;
 *  · se la lettura non è arrivata non si dice «Nessun abbonamento»: resta «Venditore»;
 *  · il Profilo (le impostazioni del negozio) dice in cima con quale piano sei.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AbbonamentoAttivo, Preventivo } from '@/lib/agenzia/preventivo';

const stato = vi.hoisted(() => ({
  pathname: '/seller/analytics',
  preventivo: null as unknown,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => stato.pathname,
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: readonly unknown[] }) =>
    o.queryKey[1] === 'preventivo-agenzia'
      ? { data: stato.preventivo ?? undefined, isLoading: false, isError: stato.preventivo == null }
      : { data: 0 },
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { signOut: async () => ({}) }, from: () => ({}) } }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 's-1', role: 'seller', store_name: 'Pane Quotidiano', email: 'pane@esempio.it' }, userEmail: 'pane@esempio.it' }),
}));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));

import SellerShell from '@/components/seller/SellerShell';
import PianoNelProfilo from '@/components/seller/PianoNelProfilo';
import { etichettaPiano } from '@/lib/agenzia/etichetta-piano';

const conPiano = (attivo: AbbonamentoAttivo | null) => ({ attivo } as unknown as Preventivo);

const accesi: Root[] = [];
async function monta(componente: unknown, figli?: unknown) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(componente as never, null, figli as never)); });
  return radice;
}
const pulsanteAccount = (r: HTMLElement) =>
  r.querySelector<HTMLButtonElement>('button[aria-controls="menu-account-venditore"]')!;

beforeEach(() => {
  stato.pathname = '/seller/analytics';
  stato.preventivo = conPiano({ fascia: 'business', stato: 'active', rinnovoIl: '2026-12-24' });
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

describe('cosa si scrive sotto il nome del negozio', () => {
  it('pagato: il nome del piano', () => {
    expect(etichettaPiano({ fascia: 'premium', stato: 'active', rinnovoIl: null }, true)).toMatchObject({ testo: 'Piano Premium', avviso: null, tono: 'attivo' });
  });
  it('pagamento non riuscito: il piano, con l avviso', () => {
    expect(etichettaPiano({ fascia: 'base', stato: 'past_due', rinnovoIl: null }, true)).toMatchObject({ testo: 'Piano Base', avviso: 'Pagamento da sistemare', tono: 'da_sistemare' });
  });
  it('nessun abbonamento: lo dice, e la voce invita a sceglierlo', () => {
    expect(etichettaPiano(null, true)).toMatchObject({ testo: 'Nessun abbonamento', tono: 'nessuno', voce: 'Scegli il tuo abbonamento' });
  });
  it('lettura non arrivata: «Venditore», mai «Nessun abbonamento»', () => {
    expect(etichettaPiano(undefined, false)).toMatchObject({ testo: 'Venditore', tono: 'sconosciuto' });
  });
});

describe('il menu del venditore, come su Claude', () => {
  it('«Abbonamento» non è più una voce del gruppo Servizi', async () => {
    const r = await monta(SellerShell, createElement('p', null, 'x'));
    expect(r.querySelector('nav a[href="/seller/abbonamento"]')).toBeNull();
    const voci = Array.from(r.querySelectorAll('nav a')).map((a) => a.textContent?.trim());
    expect(voci).not.toContain('Abbonamento');
  });

  it('in fondo al menu c è il negozio col piano sotto il nome, senza aprire niente', async () => {
    const r = await monta(SellerShell, createElement('p', null, 'x'));
    const pulsante = pulsanteAccount(r);
    expect(pulsante, 'manca il negozio in fondo al menu').not.toBeNull();
    expect(pulsante.closest('aside'), 'il negozio deve stare nel menu laterale').not.toBeNull();
    expect(pulsante.textContent).toContain('Pane Quotidiano');
    expect(pulsante.textContent).toContain('Piano Business');
    expect(pulsante.getAttribute('aria-expanded')).toBe('false');
  });

  it('un clic apre il menu dell account: abbonamento, profilo e impostazioni, marketplace, esci', async () => {
    const r = await monta(SellerShell, createElement('p', null, 'x'));
    await act(async () => { pulsanteAccount(r).click(); });
    const menu = r.querySelector('#menu-account-venditore')!;
    expect(menu, 'il menu non si apre').not.toBeNull();
    expect(pulsanteAccount(r).getAttribute('aria-expanded')).toBe('true');
    const abbonamento = menu.querySelector('a[href="/seller/abbonamento"]');
    expect(abbonamento?.textContent).toContain('Il tuo abbonamento');
    expect(abbonamento?.textContent).toContain('Piano Business');
    expect(menu.querySelector('a[href="/seller/profile"]')?.textContent).toContain('Profilo e impostazioni');
    expect(menu.querySelector('a[href="/?shop=1"]')?.textContent).toContain('Vai al marketplace');
    expect(Array.from(menu.querySelectorAll('button')).some((b) => b.textContent?.includes('Esci'))).toBe(true);
    expect(menu.textContent).toContain('pane@esempio.it');
    // 25/11/2026 — Più account senza uscire (Nicola): il blocco sta nel menu, prima di Esci.
    const cambio = menu.querySelector('[role="group"][aria-label="Cambia account"]');
    expect(cambio?.textContent).toContain('Aggiungi un altro account');
  });

  it('un pagamento non riuscito si vede già sotto il nome, e nel menu', async () => {
    stato.preventivo = conPiano({ fascia: 'base', stato: 'past_due', rinnovoIl: null });
    const r = await monta(SellerShell, createElement('p', null, 'x'));
    expect(pulsanteAccount(r).getAttribute('aria-label')).toContain('Pagamento da sistemare');
    await act(async () => { pulsanteAccount(r).click(); });
    expect(r.querySelector('#menu-account-venditore a[href="/seller/abbonamento"]')?.textContent).toContain('Pagamento da sistemare');
  });

  it('senza abbonamento la voce invita a sceglierlo', async () => {
    stato.preventivo = conPiano(null);
    const r = await monta(SellerShell, createElement('p', null, 'x'));
    expect(pulsanteAccount(r).textContent).toContain('Nessun abbonamento');
    await act(async () => { pulsanteAccount(r).click(); });
    expect(r.querySelector('#menu-account-venditore a[href="/seller/abbonamento"]')?.textContent).toContain('Scegli il tuo abbonamento');
  });

  it('se la lettura non è arrivata non dice «Nessun abbonamento»', async () => {
    stato.preventivo = null;
    const r = await monta(SellerShell, createElement('p', null, 'x'));
    expect(pulsanteAccount(r).textContent).toContain('Venditore');
    expect(r.textContent).not.toContain('Nessun abbonamento');
  });

  it('i due link che stavano in fondo (marketplace, esci) non restano doppi fuori dal menu', async () => {
    const r = await monta(SellerShell, createElement('p', null, 'x'));
    expect(r.querySelectorAll('a[href="/?shop=1"]')).toHaveLength(0);
  });
});

describe('il Profilo, cioè le impostazioni del negozio', () => {
  it('dice in cima con quale piano sei e quando si rinnova, e porta all abbonamento', async () => {
    const r = await monta(PianoNelProfilo);
    expect(r.querySelector('[data-testid="piano-nel-profilo"]')?.textContent).toBe('Piano Business');
    expect(r.textContent).toContain('si rinnova il');
    expect(r.querySelector('a[href="/seller/abbonamento"]')?.textContent).toContain('Vedi il tuo abbonamento');
  });

  it('senza abbonamento invita a sceglierlo', async () => {
    stato.preventivo = conPiano(null);
    const r = await monta(PianoNelProfilo);
    expect(r.querySelector('a[href="/seller/abbonamento"]')?.textContent).toContain('Scegli il tuo abbonamento');
  });
});
