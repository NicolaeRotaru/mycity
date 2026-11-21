/**
 * @vitest-environment jsdom
 */
/**
 * 20/11/2026 (R04-002) — NELLA SCHEDA DEL NEGOZIO UNA LETTURA CADUTA SEMBRAVA «NESSUN DATO».
 *
 * La pagina Utenti chiede codice fiscale e partita IVA di UN utente quando si apre la sua scheda
 * (/api/admin/users/[id]/kyc). Se la lettura non riusciva, la domanda rispondeva come se i dati
 * fossero vuoti, e la scheda scriveva «—»: chi approva un negozio leggeva «partita IVA non data»
 * su un negozio che l'aveva data. Adesso scrive «non disponibile: riprova».
 *
 * La pagina si monta col react-query finto: la funzione della domanda (`queryFn`) si prende dalle
 * opzioni e si esegue davvero contro una rete finta; il suo risultato è il dato che la scheda mostra.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

const globale = globalThis as Record<string, unknown>;
const reteDiPartenza = globalThis.fetch;

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

type Opzioni = { queryKey?: unknown[]; queryFn?: () => Promise<unknown> };

/** Monta la pagina, esegue la domanda dei dati d'identità con la rete data, e apre la scheda. */
async function schedaConLaRete(rete: () => Promise<unknown>) {
  let identita: unknown;
  const opzioni: Opzioni[] = [];
  globale.__OPZIONI_QUERY__ = opzioni;
  globale.__DATI_QUERY__ = (o: Opzioni) => ((o.queryKey ?? []).includes('kyc') ? identita : [IN_ATTESA]);
  globalThis.fetch = rete as unknown as typeof fetch;

  const mod = await monta('app/admin/users/page.tsx');
  const s = accendi(mod.default as ComponentType);
  const domanda = opzioni.find((o) => (o.queryKey ?? []).includes('kyc'));
  expect(domanda?.queryFn, 'la pagina non chiede più i dati d’identità: la prova non misurerebbe niente').toBeTruthy();
  identita = await domanda!.queryFn!();

  const esamina = Array.from(s.radice.querySelectorAll('button')).find((b) => b.textContent?.includes('Esamina'));
  expect(esamina, 'la pagina Utenti non mostra nessun pulsante «Esamina»').toBeTruthy();
  s.agisci(() => clicca(esamina as HTMLButtonElement));
  const scheda = document.querySelector('[role="dialog"]');
  expect(scheda, 'la scheda del negozio non si apre').toBeTruthy();
  return { s, testo: () => scheda!.textContent ?? '' };
}

afterEach(() => {
  delete globale.__DATI_QUERY__;
  delete globale.__OPZIONI_QUERY__;
  globalThis.fetch = reteDiPartenza;
  document.body.style.overflow = '';
  document.body.replaceChildren();
});

describe('R04-002 · la scheda del negozio dice quando i dati non si sono letti', () => {
  it('lettura caduta (500): «non disponibile», non il trattino di «nessun dato»', async () => {
    const { s, testo } = await schedaConLaRete(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(testo(), 'una lettura caduta si legge ancora come un codice fiscale o una partita IVA mai dati').toContain('non disponibile');
    s.smonta();
  }, 60000);

  it('rete caduta (la richiesta non parte): «non disponibile»', async () => {
    const { s, testo } = await schedaConLaRete(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(testo()).toContain('non disponibile');
    s.smonta();
  }, 60000);

  it('lettura riuscita: i dati veri, e il trattino solo dove il dato manca davvero', async () => {
    const { s, testo } = await schedaConLaRete(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ legal_fiscal_code: 'RSSMRA80A01G535X', business_vat_number: null }),
    }));
    expect(testo()).toContain('RSSMRA80A01G535X');
    expect(testo()).not.toContain('non disponibile');
    s.smonta();
  }, 60000);
});
