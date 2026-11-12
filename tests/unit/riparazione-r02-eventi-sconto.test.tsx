// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { fake, disegna, aspetta } from './aiuti/cabina-admin';

/**
 * R02-002 (12/11/2026) — Lo sconto di un evento compariva ai clienti come «-20%» ma la cassa non lo
 * applica. Finché non c'è una regola di prezzo, il modulo non lo chiede e salvare lo ripulisce.
 */

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/ImageUrlField', () => ({ ImageUrlField: () => null }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

const EVENTO_VECCHIO = {
  id: 'e1', title: 'Mercatino', description: 'Di Natale', cover_image_url: null,
  starts_at: '2026-12-10T17:00:00+00:00', ends_at: '2026-12-10T21:00:00+00:00',
  discount_percent: 20, cta_label: 'Partecipa', cta_url: null, status: 'scheduled',
};

describe('R02-002 · niente sconto sugli eventi finché la cassa non lo applica', () => {
  it('il modulo non chiede lo sconto, e salvare un evento con «20%» lo ripulisce', async () => {
    fake.rispondi = (q) => (q.tabella === 'marketplace_events' && q.op === 'select'
      ? { data: [EVENTO_VECCHIO], error: null }
      : { data: null, error: null });
    const mod = (await import('@/app/admin/events/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const modifica = [...r.host.querySelectorAll('button')].find((b) => /odific/.test(b.getAttribute('aria-label') ?? '') || /Modifica/.test(b.textContent ?? ''));
    await act(async () => { modifica?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await aspetta();
    const form = document.getElementById('event-form') as HTMLFormElement;
    expect(form).toBeTruthy();
    expect(form.textContent).not.toMatch(/Sconto %/);
    expect(form.querySelectorAll('input[type="number"]')).toHaveLength(0);
    await act(async () => { form.requestSubmit(); });
    await aspetta();
    const scritta = fake.domande.find((d) => d.op === 'update' && d.tabella === 'marketplace_events');
    expect(scritta, 'il salvataggio deve partire').toBeTruthy();
    expect((scritta!.valori as { discount_percent: unknown }).discount_percent).toBeNull();
  });
});
