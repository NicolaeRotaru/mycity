/**
 * @vitest-environment jsdom
 */
/**
 * R04-005 (onda 2, 28/11/2026) — I LINK AI DOCUMENTI DEL FATTORINO SCADONO A PANNELLO APERTO.
 *
 * La rotta firma i link per 120 secondi. Il pannello «Esamina» li rileggeva solo tornando sulla
 * scheda del browser: chi restava sul pannello a guardare la patente, poi cliccava la polizza,
 * apriva un link già scaduto (pagina d'errore del deposito). Ora poco prima della scadenza i link
 * diventano «Link scaduto: rinnova il link», e il clic chiede link nuovi alla rotta.
 *
 * Gira la pagina vera; l'orologio è finto per far passare i due minuti.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

const globale = globalThis as Record<string, unknown>;

const FATTORINO = {
  id: '11111111-2222-3333-4444-555555555555', role: 'rider', is_approved: false, approval_status: 'pending',
  approval_requested_at: '2026-10-20T09:00:00Z', approved_at: null, rejection_reason: null,
  store_name: null, full_name: 'Luca Bianchi', phone: '3330000000',
  store_address: null, legal_first_name: 'Luca', legal_last_name: 'Bianchi',
  business_legal_name: null, business_form: null, business_address: null, business_city: null,
  business_pec: null, created_at: '2026-10-01T09:00:00Z', email: 'luca@esempio.it',
  auth_phone: null, last_sign_in_at: null, email_confirmed_at: null,
};
const LINK = (n: string) => `https://firmato.esempio/${n}?token=breve`;
const DOCUMENTI = {
  legal_birth_date: '2000-03-15',
  documenti: [
    { chiave: 'patente', etichetta: 'Patente', url: LINK('patente'), scade_il: '2099-12-31' },
    { chiave: 'polizza', etichetta: 'Polizza RC', url: LINK('polizza'), scade_il: '2099-12-31' },
  ],
  veicolo: { tipo: 'BIKE', targa: null },
};

afterEach(() => {
  vi.useRealTimers();
  delete globale.__DATI_QUERY__;
  delete globale.__ESITO_QUERY__;
  document.body.style.overflow = '';
  document.body.replaceChildren();
});

async function apriLaScheda(rilettura: () => Promise<unknown>) {
  globale.__DATI_QUERY__ = (o: { queryKey?: unknown[] }) => {
    const chiave = o.queryKey ?? [];
    if (chiave.includes('documenti-rider')) return DOCUMENTI;
    if (chiave.includes('kyc')) return { legal_fiscal_code: 'BNCLCU00C15G535X', business_vat_number: null };
    if (chiave.some((k) => k && typeof k === 'object' && 'conteggio' in (k as object))) return 1;
    return [FATTORINO];
  };
  // La rilettura dei documenti è quella che il pannello chiede alla domanda dei documenti.
  globale.__ESITO_QUERY__ = (o: { queryKey?: unknown[] }) =>
    (o.queryKey ?? []).includes('documenti-rider') ? { refetch: rilettura } : undefined;
  const mod = await monta('app/admin/users/page.tsx');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const s = accendi(mod.default as ComponentType);
  const esamina = Array.from(s.radice.querySelectorAll('button')).find((b) => b.textContent?.includes('Esamina'));
  expect(esamina, 'manca «Esamina» per il fattorino in attesa').toBeTruthy();
  s.agisci(() => clicca(esamina as HTMLButtonElement));
  const dialogo = document.querySelector('[role="dialog"]') as HTMLElement | null;
  expect(dialogo, 'la scheda del fattorino non si apre').toBeTruthy();
  return { s, dialogo: dialogo as HTMLElement };
}

const linkAperti = (d: HTMLElement) => Array.from(d.querySelectorAll('a')).map((a) => a.getAttribute('href'));

describe('R04-005 · i link ai documenti del fattorino a pannello aperto', () => {
  it('appena aperto: i link ci sono', async () => {
    const { s, dialogo } = await apriLaScheda(async () => ({}));
    expect(linkAperti(dialogo)).toEqual(expect.arrayContaining([LINK('patente'), LINK('polizza')]));
    s.smonta();
  }, 60000);

  it('IL CASO CHE ROMPEVA — dopo due minuti sul pannello il link scaduto non si offre più come buono', async () => {
    const { s, dialogo } = await apriLaScheda(async () => ({}));
    await act(async () => { vi.advanceTimersByTime(115_000); });
    expect(linkAperti(dialogo), 'il pannello offre ancora link firmati già scaduti').not.toContain(LINK('polizza'));
    expect(dialogo.textContent ?? '').toContain('Link scaduto: rinnova il link');
    s.smonta();
  }, 60000);

  it('«rinnova il link» chiede link nuovi alla rotta', async () => {
    const rilettura = vi.fn(async () => ({}));
    const { s, dialogo } = await apriLaScheda(rilettura);
    await act(async () => { vi.advanceTimersByTime(115_000); });
    const rinnova = Array.from(dialogo.querySelectorAll('button')).find((b) => b.textContent?.includes('rinnova il link'));
    expect(rinnova, 'manca il modo di avere link nuovi senza chiudere il pannello').toBeTruthy();
    s.agisci(() => clicca(rinnova as HTMLButtonElement));
    expect(rilettura).toHaveBeenCalledTimes(1);
    s.smonta();
  }, 60000);
});
