/**
 * @vitest-environment jsdom
 */
/**
 * R03-001 / R03-018 — Nella scheda utente dell'amministrazione codice fiscale e partita IVA, finché
 * la lettura è in corso, non mostrano «—» (che vuol dire «non c'è»): mostrano che si sta caricando.
 * Arrivati i dati, tornano i valori veri e il trattino solo dove il dato manca davvero.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

const globale = globalThis as Record<string, unknown>;

const IN_ATTESA = {
  id: 'venditore-1', role: 'seller', is_approved: false, approval_status: 'pending',
  approval_requested_at: '2026-08-20T09:00:00Z', approved_at: null, rejection_reason: null,
  store_name: 'Pane Quotidiano', full_name: 'Mario Rossi', phone: '0523111222',
  store_address: 'via Roma 1', legal_first_name: 'Mario', legal_last_name: 'Rossi',
  legal_fiscal_code: null, business_legal_name: 'Pane Quotidiano srl', business_vat_number: null,
  business_form: 'SRL', business_address: 'via Roma 1', business_city: 'Piacenza',
  business_pec: 'pane@pec.it', created_at: '2026-08-01T09:00:00Z', email: 'mario@pane.it',
  auth_phone: null, last_sign_in_at: null, email_confirmed_at: null,
};

type Opzioni = { queryKey?: unknown[] };

async function scheda(identita: unknown) {
  globale.__OPZIONI_QUERY__ = [] as Opzioni[];
  globale.__DATI_QUERY__ = (o: Opzioni) => ((o.queryKey ?? []).includes('kyc') ? identita : [IN_ATTESA]);
  const mod = await monta('app/admin/users/page.tsx');
  const s = accendi(mod.default as ComponentType);
  const esamina = Array.from(s.radice.querySelectorAll('button')).find((b) => b.textContent?.includes('Esamina'));
  expect(esamina, 'la pagina Utenti non mostra nessun pulsante «Esamina»').toBeTruthy();
  s.agisci(() => clicca(esamina as HTMLButtonElement));
  const dialogo = document.querySelector('[role="dialog"]');
  expect(dialogo, 'la scheda non si apre').toBeTruthy();
  const codici = Array.from(dialogo!.querySelectorAll('code')).map((c) => c.textContent);
  return { s, codiceFiscale: codici[0], partitaIva: codici[1] };
}

afterEach(() => {
  delete globale.__DATI_QUERY__;
  delete globale.__OPZIONI_QUERY__;
  document.body.style.overflow = '';
  document.body.replaceChildren();
});

describe('R03-001 / R03-018 · la scheda utente dice che sta caricando', () => {
  it('lettura in corso: codice fiscale e partita IVA non sono «—»', async () => {
    const { s, codiceFiscale, partitaIva } = await scheda(undefined);
    expect(codiceFiscale, 'il codice fiscale in caricamento sembra «nessun codice fiscale»').not.toBe('—');
    expect(partitaIva, 'la partita IVA in caricamento sembra «nessuna partita IVA»').not.toBe('—');
    expect(codiceFiscale).toMatch(/Caricamento/);
    expect(partitaIva).toMatch(/Caricamento/);
    s.smonta();
  }, 60000);

  it('lettura arrivata: i valori veri, e «—» solo dove il dato manca davvero', async () => {
    const { s, codiceFiscale, partitaIva } = await scheda({ legal_fiscal_code: 'RSSMRA80A01G535X', business_vat_number: null });
    expect(codiceFiscale).toBe('RSSMRA80A01G535X');
    expect(partitaIva).toBe('—');
    s.smonta();
  }, 60000);
});
