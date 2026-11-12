/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * R03-016 — Un fattorino nuovo salva i dati del primo passo anche senza le scadenze di patente
 * e polizza.
 *
 * Il modulo teneva in un oggetto solo i campi del passo 1 e del passo 2, con le due scadenze a
 * stringa vuota. «Salva i dati» mandava l'oggetto intero: Postgres rifiuta '' come data
 * (22007), la scrittura cadeva e i caricamenti dei documenti restavano chiusi. Chi va in bici
 * senza patente non ha una data vera da scrivere. Il database finto qui rifiuta '' su una
 * colonna data, come quello vero.
 */

const globali = globalThis as Record<string, unknown>;
const COLONNE_DATA = ['legal_birth_date', 'rider_license_expires_on', 'rider_insurance_expires_on', 'rider_haccp_expires_on'];
const scritture: Array<Record<string, unknown>> = [];

function database(profilo: Record<string, unknown>) {
  return {
    from: (tavola: string) => {
      const c: Record<string, unknown> = {};
      let valori: Record<string, unknown> | null = null;
      for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit']) c[m] = () => c;
      c.update = (v: Record<string, unknown>) => { valori = v; return c; };
      const esito = () => {
        if (!valori) return { data: tavola === 'profiles' ? profilo : null, error: null };
        scritture.push(valori);
        const vuota = COLONNE_DATA.find((k) => valori![k] === '');
        return vuota
          ? { data: null, error: { code: '22007', message: `invalid input syntax for type date: "" (${vuota})` } }
          : { data: null, error: null };
      };
      c.single = async () => esito();
      c.maybeSingle = c.single;
      c.then = (r: (v: unknown) => unknown) => Promise.resolve(esito()).then(r);
      return c;
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  scritture.length = 0;
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__']) globali[k] = undefined;
});

describe('R03-016 — il passo 1 si salva con le scadenze vuote', () => {
  it('nome, cognome, codice fiscale e nascita compilati, scadenze vuote: «Salva i dati» scrive senza date vuote', async () => {
    globali.__UTENTE__ = { id: 'fattorino-1', email: 'f@test.it' };
    globali.__CLIENT_SUPABASE__ = database({
      id: 'fattorino-1', legal_first_name: 'Mario', legal_last_name: 'Rossi', legal_fiscal_code: 'RSSMRA90A01G535X',
      legal_birth_date: '1990-01-01', rider_vehicle_type: 'BIKE', rider_license_expires_on: null, rider_insurance_expires_on: null,
    });
    const pagina = (await monta('app/rider/onboarding/page.tsx')).default;
    const s = accendi(pagina as never, {});
    for (let i = 0; i < 10; i++) await attendi();
    const salva = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('Salva i dati'));
    expect(salva, 'controprova: il pulsante del passo 1 si deve vedere').toBeTruthy();
    s.agisci(() => clicca(salva!));
    for (let i = 0; i < 10; i++) await attendi();
    expect(scritture.length).toBeGreaterThan(0);
    const corpo = scritture[0];
    expect(corpo.legal_first_name).toBe('Mario');
    for (const k of COLONNE_DATA) expect(corpo[k], `${k} parte come stringa vuota: Postgres la rifiuta`).not.toBe('');
    s.smonta();
  }, 60000);
});
