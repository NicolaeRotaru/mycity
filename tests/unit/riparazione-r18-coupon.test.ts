// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { fake, disegna, scrivi, aspetta } from './aiuti/cabina-admin';

/**
 * R18-019 — Il modulo dei codici sconto non manda una percentuale oltre 100.
 *
 * Il campo «Valore» aveva `min={0}` e nessun massimo: l'amministratore che scriveva «150» invece di
 * «15» creava un codice che regalava più della spesa, senza nessun messaggio. Adesso, col tipo
 * percentuale, il campo ha un massimo di 100 e il browser non spedisce il modulo; uno sconto fisso
 * di 150 euro resta un importo legittimo. (Il paletto vero sta nel database: migrazione 423 e
 * tests/sql/rls/riparazione-r18-coupon.test.sql.)
 */

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

async function apriModulo() {
  fake.rispondi = (q) => (q.op === 'insert' ? { data: [{ id: 'nuovo' }], error: null } : { data: [], error: null });
  const mod = (await import('@/app/admin/coupons/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  const nuovo = [...r.host.querySelectorAll('button')].find((b) => b.textContent?.includes('Nuovo coupon'));
  await act(async () => { nuovo?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await aspetta();
  return r.host;
}

function campi(host: HTMLElement) {
  const inputs = [...host.querySelectorAll('input')] as HTMLInputElement[];
  const codice = inputs.find((i) => i.placeholder === 'ESTATE25') as HTMLInputElement;
  const valore = inputs.find((i) => i.type === 'number') as HTMLInputElement;
  const tipo = host.querySelector('select') as HTMLSelectElement;
  const crea = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Crea coupon')) as HTMLButtonElement;
  return { codice, valore, tipo, crea };
}

async function invia(crea: HTMLButtonElement) {
  await act(async () => { crea.click(); });
  await aspetta();
}

const inserimenti = () => fake.domande.filter((d) => d.tabella === 'coupons' && d.op === 'insert');

describe('R18-019 · il modulo dei codici sconto', () => {
  it('una percentuale da 150 non parte: il campo non la accetta e nessun codice si scrive', async () => {
    const host = await apriModulo();
    const { codice, valore, crea } = campi(host);
    await scrivi(codice, 'ESTATE150');
    await scrivi(valore, '150');
    expect(valore.validity.valid, 'il campo percentuale deve rifiutare 150').toBe(false);
    await invia(crea);
    expect(inserimenti()).toHaveLength(0);
  });

  it('una percentuale da 15 parte normalmente', async () => {
    const host = await apriModulo();
    const { codice, valore, crea } = campi(host);
    await scrivi(codice, 'ESTATE15');
    await scrivi(valore, '15');
    await invia(crea);
    expect(inserimenti()).toHaveLength(1);
    expect(inserimenti()[0].valori).toMatchObject({ code: 'ESTATE15', type: 'PERCENT', value: 15 });
  });

  it('uno sconto fisso da 150 euro resta possibile', async () => {
    const host = await apriModulo();
    const { codice, tipo, crea } = campi(host);
    await scrivi(codice, 'GROSSO150');
    await scrivi(tipo, 'FIXED');
    const { valore } = campi(host);
    await scrivi(valore, '150');
    expect(valore.validity.valid).toBe(true);
    await invia(crea);
    expect(inserimenti()).toHaveLength(1);
    expect(inserimenti()[0].valori).toMatchObject({ code: 'GROSSO150', type: 'FIXED', value: 150 });
  });
});
