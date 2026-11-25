/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
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
 *
 * 25/11/2026 — L'ANAGRAFICA LA SCRIVE IL SERVER (migrazione 861). Nome, cognome, codice
 * fiscale e nascita non sono più fra i campi che il fattorino cambia di sé dal browser: il
 * database finto li rifiuta come quello vero (42501), e il modulo li manda a
 * PATCH /api/rider/anagrafica. Queste prove diventano rosse se il modulo torna a scriverli
 * col client Supabase del browser.
 */

const globali = globalThis as Record<string, unknown>;
const COLONNE_DATA = ['legal_birth_date', 'rider_license_expires_on', 'rider_insurance_expires_on', 'rider_haccp_expires_on'];
const COLONNE_LEGALI = [
  'legal_first_name', 'legal_last_name', 'legal_birth_date', 'legal_fiscal_code',
  'legal_residence_addr', 'legal_residence_city', 'legal_residence_zip',
];
const scritture: Array<Record<string, unknown>> = [];
/** Le chiamate al server, in ordine: indirizzo e corpo. */
const chiamate: Array<{ url: string; corpo: Record<string, unknown> | null }> = [];

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
        // Come la guardia vera dopo la 861: una colonna legale nella scrittura del browser non passa.
        const legale = COLONNE_LEGALI.find((k) => k in valori!);
        if (legale) return { data: null, error: { code: '42501', message: 'profiles: campo riservato non modificabile' } };
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

function serverFinto() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const corpo = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    chiamate.push({ url, corpo });
    const risposta = url === '/api/kyc/start-check' ? { status: 'PENDING' } : { ok: true };
    return new Response(JSON.stringify(risposta), { status: 200 });
  }));
}

const PROFILO = {
  id: 'fattorino-1', legal_first_name: 'Mario', legal_last_name: 'Rossi', legal_fiscal_code: 'RSSMRA90A01G535X',
  legal_birth_date: '1990-01-01', rider_vehicle_type: 'BIKE', rider_license_expires_on: null, rider_insurance_expires_on: null,
};

afterEach(() => {
  document.body.innerHTML = '';
  scritture.length = 0;
  chiamate.length = 0;
  vi.unstubAllGlobals();
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__', '__GETTONE__']) globali[k] = undefined;
});

const pulsante = (testo: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(testo));

describe('R03-016 — il passo 1 si salva con le scadenze vuote', () => {
  it('nome, cognome, codice fiscale e nascita compilati, scadenze vuote: «Salva i dati» li manda al server, senza date vuote', async () => {
    globali.__UTENTE__ = { id: 'fattorino-1', email: 'f@test.it' };
    globali.__GETTONE__ = 'gettone-di-prova';
    globali.__CLIENT_SUPABASE__ = database(PROFILO);
    serverFinto();
    const pagina = (await monta('app/rider/onboarding/page.tsx')).default;
    const s = accendi(pagina as never, {});
    for (let i = 0; i < 10; i++) await attendi();
    const salva = pulsante('Salva i dati');
    expect(salva, 'controprova: il pulsante del passo 1 si deve vedere').toBeTruthy();
    s.agisci(() => clicca(salva!));
    for (let i = 0; i < 10; i++) await attendi();

    const anagrafica = chiamate.filter((c) => c.url === '/api/rider/anagrafica');
    expect(anagrafica, '«Salva i dati» non passa più dal server').toHaveLength(1);
    expect(anagrafica[0].corpo).toEqual({
      legalFirstName: 'Mario', legalLastName: 'Rossi', legalFiscalCode: 'RSSMRA90A01G535X', legalBirthDate: '1990-01-01',
    });
    expect(
      scritture.filter((w) => COLONNE_LEGALI.some((k) => k in w)),
      'il modulo scrive di nuovo i dati legali col client del browser: la guardia (861) lo rifiuta',
    ).toEqual([]);
    s.smonta();
  }, 60000);
});

describe('«Salva e avvia verifica» — anagrafica dal server, mezzo dal browser', () => {
  it('prima l anagrafica al server, poi i dati del mezzo senza date vuote, poi la verifica', async () => {
    globali.__UTENTE__ = { id: 'fattorino-1', email: 'f@test.it' };
    globali.__GETTONE__ = 'gettone-di-prova';
    // In bici bastano documento e selfie (R03-024): con quelli il pulsante si accende.
    globali.__CLIENT_SUPABASE__ = database({ ...PROFILO, kyc_id_doc_front_url: 'kyc/f.jpg', kyc_selfie_url: 'kyc/s.jpg' });
    serverFinto();
    const pagina = (await monta('app/rider/onboarding/page.tsx')).default;
    const s = accendi(pagina as never, {});
    for (let i = 0; i < 10; i++) await attendi();
    const avvia = pulsante('Salva e avvia verifica');
    expect(avvia, 'controprova: il pulsante finale si deve vedere').toBeTruthy();
    expect(avvia!.disabled, 'controprova: con documento e selfie il pulsante deve essere acceso').toBe(false);
    s.agisci(() => clicca(avvia!));
    for (let i = 0; i < 15; i++) await attendi();

    expect(chiamate.map((c) => c.url), 'l ordine: anagrafica al server, poi la verifica').toEqual([
      '/api/rider/anagrafica',
      '/api/kyc/start-check',
    ]);
    expect(scritture, 'i dati del mezzo si scrivono una volta, dal browser').toHaveLength(1);
    const mezzo = scritture[0];
    expect(Object.keys(mezzo).sort()).toEqual(
      ['rider_insurance_expires_on', 'rider_license_expires_on', 'rider_vehicle_plate', 'rider_vehicle_type'],
    );
    for (const k of COLONNE_DATA) expect(mezzo[k], `${k} parte come stringa vuota: Postgres la rifiuta`).not.toBe('');
    s.smonta();
  }, 60000);
});
