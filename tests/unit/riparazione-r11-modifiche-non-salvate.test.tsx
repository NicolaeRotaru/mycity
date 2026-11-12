// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * R11-015 — Le modifiche ai dettagli del negozio e al profilo si perdevano
 * uscendo, senza nessun avviso. Con una modifica non salvata il browser deve
 * chiedere conferma prima di lasciare la pagina (beforeunload).
 */

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { id: 'forno' } } }) } } }));

import VendorForm from '@/components/VendorForm';

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; });

const lasciaLaPagina = () => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

function scrivi(campo: HTMLInputElement | HTMLTextAreaElement, valore: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(campo), 'value')!.set!;
  setter.call(campo, valore);
  campo.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('R11-015 — modifiche non salvate', () => {
  it('senza modifiche si esce senza domande; con una modifica il browser chiede conferma', async () => {
    const r = await disegna(
      createElement(VendorForm, { mode: 'branding', onSubmit: () => {}, defaultValues: { storeName: 'Pane Quotidiano', storeDescription: 'Forno' } }),
    );
    chiudi = r.chiudi;
    expect(lasciaLaPagina()).toBe(false);
    const nome = r.host.querySelector('input[name="storeName"]') as HTMLInputElement;
    expect(nome).toBeTruthy();
    await act(async () => { scrivi(nome, 'Pane Quotidiano di Piacenza'); await new Promise((ok) => setTimeout(ok, 10)); });
    expect(lasciaLaPagina(), 'il nome nuovo si perde uscendo, senza nessun avviso').toBe(true);
  });
});

describe('R11-015 — dal controllo qa', () => {
  it('se il salvataggio fallisce le modifiche restano «non salvate»', async () => {
    const r = await disegna(
      createElement(VendorForm, {
        mode: 'branding',
        onSubmit: () => Promise.reject(new Error('rete giù')),
        defaultValues: { storeName: 'Pane Quotidiano', storeDescription: 'Forno' },
      }),
    );
    chiudi = r.chiudi;
    const nome = r.host.querySelector('input[name="storeName"]') as HTMLInputElement;
    await act(async () => { scrivi(nome, 'Pane Quotidiano di Piacenza'); await new Promise((ok) => setTimeout(ok, 10)); });
    await act(async () => {
      (r.host.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((ok) => setTimeout(ok, 30));
    });
    expect(lasciaLaPagina(), 'salvataggio fallito e nessun avviso: le modifiche si perdono uscendo').toBe(true);
  });

  it('se il salvataggio riesce, si esce senza domande', async () => {
    const r = await disegna(
      createElement(VendorForm, { mode: 'branding', onSubmit: () => Promise.resolve(), defaultValues: { storeName: 'Pane Quotidiano' } }),
    );
    chiudi = r.chiudi;
    const nome = r.host.querySelector('input[name="storeName"]') as HTMLInputElement;
    await act(async () => { scrivi(nome, 'Pane Quotidiano 2'); await new Promise((ok) => setTimeout(ok, 10)); });
    await act(async () => {
      (r.host.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((ok) => setTimeout(ok, 30));
    });
    expect(lasciaLaPagina()).toBe(false);
  });
});
