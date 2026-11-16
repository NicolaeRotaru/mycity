/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * R26-002 (giro di correzione, collaudo K07) — I documenti dell'iscrizione del fattorino hanno il campo
 * «scegli file» `sr-only`: col Tab ci si arriva, ma il fuoco non si vedeva da nessuna parte.
 * Il riquadro che lo contiene deve mostrare l'anello quando il campo dentro ha il fuoco.
 * Si monta la pagina vera.
 */
const globali = globalThis as Record<string, unknown>;
afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__']) globali[k] = undefined;
});

describe('R26-002 — documenti del fattorino col fuoco visibile', () => {
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
    const campi = [...document.querySelectorAll('input[type="file"]')] as HTMLInputElement[];
    expect(campi.length, 'controprova: i documenti da caricare si vedono').toBeGreaterThanOrEqual(2);
    campi.forEach((c, i) => {
      const dove = `documento ${i + 1} dell'iscrizione`;
      expect(c.classList.contains('hidden'), `${dove}: un campo hidden non si raggiunge col Tab`).toBe(false);
      expect(c.classList.contains('sr-only'), `${dove}: il campo resta raggiungibile`).toBe(true);
      const riquadro = c.closest('label');
      expect(riquadro, `${dove}: il campo sta dentro il suo riquadro`).toBeTruthy();
      expect(riquadro!.className, `${dove}: il riquadro mostra il fuoco`).toContain('focus-within:ring-2');
      expect(riquadro!.className, `${dove}: l'anello si vede sul fondo chiaro`).toContain('focus-within:ring-primary-700');
    });
    s.smonta();
  }, 60000);
});
