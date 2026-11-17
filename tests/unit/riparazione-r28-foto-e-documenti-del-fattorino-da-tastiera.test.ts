/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * R28-002 (riprende R18-002, collaudo K07) — I campi «scegli file» del fattorino sono `sr-only`:
 * col Tab ci si arriva, ma il fuoco non si vedeva da nessuna parte. Il riquadro che li contiene
 * (le foto dei contanti e della consegna nel pannello dei contanti, i documenti dell'iscrizione)
 * deve mostrare l'anello quando il campo dentro ha il fuoco, come l'importazione CSV e il reso.
 * Si montano il pannello e la pagina veri.
 */

const globali = globalThis as Record<string, unknown>;
afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__']) globali[k] = undefined;
});

function campiFile(radice: ParentNode) {
  return [...radice.querySelectorAll('input[type="file"]')] as HTMLInputElement[];
}
function controllaAnello(input: HTMLInputElement, dove: string) {
  expect(input.classList.contains('hidden'), `${dove}: un campo hidden non si raggiunge col Tab`).toBe(false);
  expect(input.classList.contains('sr-only'), `${dove}: il campo resta nascosto alla vista ma raggiungibile`).toBe(true);
  const riquadro = input.closest('label');
  expect(riquadro, `${dove}: il campo sta dentro il suo riquadro`).toBeTruthy();
  expect(riquadro!.className, `${dove}: il riquadro mostra il fuoco`).toContain('focus-within:ring-2');
  expect(riquadro!.className, `${dove}: l'anello si vede sul fondo chiaro`).toContain('focus-within:ring-primary-700');
}

describe('R28-002 — foto e documenti del fattorino col fuoco visibile', () => {
  it('pannello dei contanti: la foto dei contanti e quella della consegna mostrano il fuoco', async () => {
    const Pannello = (await monta('components/rider/CashConfirmDialog.tsx')).default as ComponentType<Record<string, unknown>>;
    const s = accendi(Pannello, { orderId: 'ordine-1', expectedCents: 6000, aperto: true, onChiudi: () => {} });
    const campi = campiFile(document);
    expect(campi.length, 'controprova: due foto nel pannello').toBe(2);
    campi.forEach((c, i) => controllaAnello(c, `foto ${i + 1} del pannello dei contanti`));
    s.smonta();
  }, 60000);

  it('iscrizione del fattorino: ogni documento da caricare mostra il fuoco', async () => {
    globali.__UTENTE__ = { id: 'fattorino-1', email: 'f@test.it' };
    const profilo = {
      id: 'fattorino-1', legal_first_name: 'Mario', legal_last_name: 'Rossi', legal_fiscal_code: 'RSSMRA90A01G535X',
      legal_birth_date: '1990-01-01', rider_vehicle_type: 'BIKE',
    };
    globali.__CLIENT_SUPABASE__ = {
      from: () => {
        const c: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'update']) c[m] = () => c;
        c.single = async () => ({ data: profilo, error: null });
        c.maybeSingle = c.single;
        c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: profilo, error: null }).then(r);
        return c;
      },
    };
    const Pagina = (await monta('app/rider/onboarding/page.tsx')).default;
    const s = accendi(Pagina as never, {});
    for (let i = 0; i < 10; i++) await attendi();
    const campi = campiFile(document);
    expect(campi.length, 'controprova: i documenti da caricare si vedono').toBeGreaterThanOrEqual(2);
    campi.forEach((c, i) => controllaAnello(c, `documento ${i + 1} dell'iscrizione`));
    s.smonta();
  }, 60000);
});
