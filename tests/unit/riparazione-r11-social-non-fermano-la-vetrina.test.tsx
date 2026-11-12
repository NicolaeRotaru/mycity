// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * R11-016 — Incollare il link di Instagram copiato dall'app (con «?igsh=…») o
 * scrivere su Facebook il nome con gli spazi bloccava il salvataggio di TUTTA la
 * vetrina (nome, logo, descrizione, colore), con un messaggio in fondo alla
 * sezione chiusa.
 */

const toasts = vi.hoisted(() => ({ avvisi: [] as string[], errori: [] as string[] }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: (m: string) => toasts.errori.push(m), warning: (m: string) => toasts.avvisi.push(m) }),
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { id: 'forno' } } }) } } }));

import VendorForm, { type VendorFormData } from '@/components/VendorForm';

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; });

async function salvaConSocial(socials: Record<string, string>) {
  const salvati: VendorFormData[] = [];
  const r = await disegna(
    createElement(VendorForm, {
      mode: 'branding',
      onSubmit: (d: VendorFormData) => salvati.push(d),
      defaultValues: { storeName: 'Pane Quotidiano', storeDescription: 'Forno di via Calzolai', storeCustomization: { socials } },
    }),
  );
  chiudi = r.chiudi;
  const modulo = r.host.querySelector('form') as HTMLFormElement;
  await act(async () => {
    modulo.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((ok) => setTimeout(ok, 30));
  });
  return { salvati, host: r.host };
}

describe('R11-016 — i social non fermano la vetrina', () => {
  it('il link di Instagram copiato dall app si salva come nome del profilo', async () => {
    const { salvati } = await salvaConSocial({ instagram: 'https://www.instagram.com/panequotidiano?igsh=MWx4bGZz' });
    expect(salvati, 'il link copiato dall app blocca il salvataggio di tutta la vetrina').toHaveLength(1);
    expect(salvati[0].storeCustomization?.socials?.instagram).toBe('panequotidiano');
  });

  it('un Facebook scritto male non ferma nome e descrizione, e il motivo sta sotto il campo', async () => {
    const { salvati, host } = await salvaConSocial({ facebook: 'Pane Quotidiano Piacenza', instagram: 'panequotidiano' });
    expect(salvati, 'un campo social sbagliato fa perdere anche nome, logo e descrizione').toHaveLength(1);
    expect(salvati[0].storeName).toBe('Pane Quotidiano');
    expect(salvati[0].storeCustomization?.socials?.facebook).toBeUndefined();
    expect(salvati[0].storeCustomization?.socials?.instagram).toBe('panequotidiano');
    expect(host.querySelector('#social-facebook-errore')?.textContent).toMatch(/Facebook/);
    expect(toasts.avvisi.join(' ')).toMatch(/Facebook/);
  });
});
