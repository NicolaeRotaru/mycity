/**
 * @vitest-environment jsdom
 */
/**
 * R04-014 (onda 2, 28/11/2026) — IL NOME DEL NEGOZIO NEL PANNELLO ADMIN HA IL TETTO DI 80 CARATTERI.
 *
 * «Modifica utente» non aveva nessun tetto sul nome del negozio: oltre 80 caratteri il salvataggio
 * partiva e il database (migrazione 830) lo rifiutava solo dopo. Ora il modulo conta, lo dice e non
 * salva. Un nome vecchio già oltre il tetto, non toccato, resta salvabile (il database guarda il
 * nome solo quando cambia).
 *
 * Gira la pagina vera; `__MUTAZIONI__` raccoglie quello che il modulo chiede di salvare.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

const globale = globalThis as Record<string, unknown>;
type Riga = Record<string, unknown>;

const negozio = (store_name: string): Riga => ({
  id: 'negozio-1', role: 'seller', is_approved: true, approval_status: 'approved', approval_requested_at: null,
  approved_at: null, rejection_reason: null, store_name, full_name: 'Maria Rossi', phone: '3331112222',
  store_address: 'Via Roma 1', legal_first_name: null, legal_last_name: null, business_legal_name: null,
  business_form: null, business_address: null, business_city: null, business_pec: null,
  created_at: '2026-11-01T09:00:00Z', email: 'maria@esempio.it', auth_phone: null, last_sign_in_at: null, email_confirmed_at: null,
});

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  delete globale.__DATI_QUERY__;
  delete globale.__MUTAZIONI__;
  document.body.style.overflow = '';
  document.body.replaceChildren();
});

async function apriModifica(nome: string) {
  globale.__DATI_QUERY__ = (o: { queryKey?: unknown[] }) => {
    const filtri = ((o.queryKey ?? [])[2] ?? {}) as Riga;
    if (filtri.conteggio === 'totale') return 1;
    return [negozio(nome)];
  };
  globale.__MUTAZIONI__ = [];
  const mod = await monta('app/admin/users/page.tsx');
  schermo = accendi(mod.default as ComponentType);
  const modifica = [...schermo.radice.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Modifica');
  expect(modifica, 'manca «Modifica»').toBeTruthy();
  await act(async () => { clicca(modifica!); });
  const etichetta = [...document.querySelectorAll('label')].find((l) => (l.textContent ?? '').trim() === 'Nome negozio');
  const campo = (etichetta?.parentElement?.querySelector('input') ?? null) as HTMLInputElement | null;
  expect(campo, 'il campo «Nome negozio» non c’è').toBeTruthy();
  return campo!;
}

async function scrivi(campo: HTMLInputElement, testo: string) {
  const imposta = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    imposta.call(campo, testo);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function salva() {
  const modulo = document.getElementById('edit-user-form') as HTMLFormElement;
  await act(async () => { modulo.requestSubmit(); });
  await attendi();
}

const salvati = () => (globale.__MUTAZIONI__ as Array<{ patch: Riga }>).map((m) => m.patch);

describe('R04-014 · il nome del negozio in «Modifica utente»', () => {
  it('IL CASO CHE ROMPEVA — 81 caratteri: il modulo lo dice e non salva', async () => {
    const campo = await apriModifica('Forno Rossi');
    await scrivi(campo, 'B'.repeat(81));
    expect(document.body.textContent ?? '').toContain('al massimo 80 caratteri');
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    await salva();
    expect(salvati(), 'il nome di 81 caratteri è partito verso il database').toEqual([]);
  }, 60000);

  it('80 caratteri esatti si salvano (gli spazi in testa e in coda non contano)', async () => {
    const campo = await apriModifica('Forno Rossi');
    await scrivi(campo, `  ${'B'.repeat(80)}  `);
    await salva();
    expect(salvati()).toHaveLength(1);
    expect(salvati()[0].store_name).toBe('B'.repeat(80));
  }, 60000);

  it('le lettere accentate contano una volta sola, come nel database', async () => {
    const campo = await apriModifica('Forno Rossi');
    await scrivi(campo, 'è'.normalize('NFC').repeat(80));
    await salva();
    expect(salvati()).toHaveLength(1);
  }, 60000);

  it('controprova: un nome vecchio già oltre il tetto, non toccato, non blocca il resto della scheda', async () => {
    await apriModifica('N'.repeat(95));
    await salva();
    expect(salvati()).toHaveLength(1);
  }, 60000);
});
