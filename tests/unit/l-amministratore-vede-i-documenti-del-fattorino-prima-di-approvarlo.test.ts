/**
 * @vitest-environment jsdom
 *
 * Ondata 3 — l'amministratore approvava i fattorini alla cieca.
 *
 * In produzione la verifica e' solo manuale (ManualReviewKycProvider lascia
 * tutto PENDING): l'occhio di chi approva e' l'unico controllo. Ma il pannello
 * «Esamina» di un fattorino era quello dei negozi — «Richiesta venditore»,
 * Vetrina, Azienda, P.IVA, PEC, tutte «—» — senza patente, polizza, documento
 * ne' eta'. E «Approva» restava cliccabile con la polizza scaduta o con un
 * minorenne.
 *
 * Questa prova monta la pagina vera, apre la scheda di un fattorino in attesa
 * e guarda cosa vede l'amministratore.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

const globale = globalThis as Record<string, unknown>;

const FATTORINO = {
  id: '11111111-2222-3333-4444-555555555555', role: 'rider', is_approved: false, approval_status: 'pending',
  approval_requested_at: '2026-10-20T09:00:00Z', approved_at: null, rejection_reason: null,
  store_name: null, full_name: 'Luca Bianchi', phone: '3330000000',
  store_address: null, legal_first_name: 'Luca', legal_last_name: 'Bianchi',
  legal_fiscal_code: null, business_legal_name: null, business_vat_number: null,
  business_form: null, business_address: null, business_city: null,
  business_pec: null, created_at: '2026-10-01T09:00:00Z', email: 'luca@esempio.it',
  auth_phone: null, last_sign_in_at: null, email_confirmed_at: null,
};

const LINK = (n: string) => `https://firmato.esempio/${n}?token=breve`;

function documenti(over: { nascita?: string; polizzaScade?: string; patente?: string | null } = {}) {
  return {
    legal_birth_date: over.nascita ?? '2000-03-15',
    documenti: [
      { chiave: 'documento_fronte', etichetta: "Documento d'identità (fronte)", url: LINK('fronte'), scade_il: null },
      { chiave: 'documento_retro', etichetta: "Documento d'identità (retro)", url: LINK('retro'), scade_il: null },
      { chiave: 'selfie', etichetta: 'Selfie', url: LINK('selfie'), scade_il: null },
      { chiave: 'patente', etichetta: 'Patente', url: over.patente === null ? null : LINK('patente'), scade_il: '2099-12-31' },
      { chiave: 'polizza', etichetta: 'Polizza RC', url: LINK('polizza'), scade_il: over.polizzaScade ?? '2099-12-31' },
    ],
  };
}

function conUnFattorinoInAttesa(dati: ReturnType<typeof documenti>) {
  globale.__DATI_QUERY__ = (o: { queryKey?: unknown[] }) => {
    const chiave = o.queryKey ?? [];
    if (chiave.includes('documenti-rider')) return dati;
    if (chiave.includes('kyc')) return { legal_fiscal_code: 'BNCLCU00C15G535X', business_vat_number: null };
    return [FATTORINO];
  };
}

async function apriLaScheda() {
  const mod = await monta('app/admin/users/page.tsx');
  const s = accendi(mod.default as ComponentType);
  const esamina = Array.from(s.radice.querySelectorAll('button')).find((b) => b.textContent?.includes('Esamina'));
  expect(esamina, 'la pagina Utenti non mostra «Esamina» per il fattorino in attesa').toBeTruthy();
  s.agisci(() => clicca(esamina as HTMLButtonElement));
  const dialogo = document.querySelector('[role="dialog"]') as HTMLElement | null;
  expect(dialogo, 'la scheda del fattorino non si apre').toBeTruthy();
  const approva = Array.from((dialogo as HTMLElement).querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Approva'),
  ) as HTMLButtonElement | undefined;
  expect(approva, 'manca il pulsante «Approva»').toBeTruthy();
  return { s, dialogo: dialogo as HTMLElement, approva: approva as HTMLButtonElement };
}

afterEach(() => {
  delete globale.__DATI_QUERY__;
  document.body.style.overflow = '';
  document.body.replaceChildren();
});

describe('la scheda di un fattorino in attesa', () => {
  it('mostra eta\', documento, selfie, patente e polizza con i link, e non si chiama «Richiesta venditore»', async () => {
    conUnFattorinoInAttesa(documenti());
    const { s, dialogo, approva } = await apriLaScheda();
    const testo = dialogo.textContent ?? '';

    expect(testo, 'Il pannello di un fattorino si intitolava «Richiesta venditore»').not.toContain('Richiesta venditore');
    expect(testo).toContain('Richiesta fattorino');
    expect(testo, "L'eta' del fattorino non si vedeva: un minorenne passava senza che nessuno se ne accorgesse").toMatch(/\d+ anni/);

    const link = Array.from(dialogo.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    for (const n of ['fronte', 'selfie', 'patente', 'polizza']) {
      expect(link, `Nel pannello non c'era il link al documento «${n}»: si approvava senza vederlo`).toContain(LINK(n));
    }
    expect(approva.disabled, 'Con tutto in regola «Approva» deve funzionare').toBe(false);
    s.smonta();
  }, 60000);

  it('con la polizza scaduta «Approva» e\' spento e il pannello dice perche\'', async () => {
    conUnFattorinoInAttesa(documenti({ polizzaScade: '2020-01-31' }));
    const { s, dialogo, approva } = await apriLaScheda();
    expect(approva.disabled, 'Si poteva approvare un fattorino con la polizza RC scaduta').toBe(true);
    expect(dialogo.textContent ?? '').toContain('Scaduto: Polizza RC');
    s.smonta();
  }, 60000);

  it('senza patente «Approva» e\' spento', async () => {
    conUnFattorinoInAttesa(documenti({ patente: null }));
    const { s, dialogo, approva } = await apriLaScheda();
    expect(approva.disabled, 'Si poteva approvare un fattorino senza patente caricata').toBe(true);
    expect(dialogo.textContent ?? '').toContain('Manca: Patente');
    s.smonta();
  }, 60000);

  it('un minorenne non si approva', async () => {
    conUnFattorinoInAttesa(documenti({ nascita: '2015-06-01' }));
    const { s, dialogo, approva } = await apriLaScheda();
    expect(approva.disabled, 'Si poteva approvare un fattorino minorenne').toBe(true);
    expect(dialogo.textContent ?? '').toContain('minorenne');
    s.smonta();
  }, 60000);
});
