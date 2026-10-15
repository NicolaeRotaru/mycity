/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * R71 — NEL MODULO DI RESO LA PRIMA SCELTA E' IL BONIFICO, NON IL CREDITO.
 *
 * L'articolo 56 del Codice del Consumo vuole il rimborso con lo stesso mezzo
 * usato per pagare, salvo che il cliente abbia «espressamente convenuto
 * altrimenti». Una casella del credito gia' spuntata non e' un consenso
 * espresso: chi preme «Invia» senza toccare niente avrebbe ricevuto credito
 * MyCity, cioe' il difetto R71 rimesso in piedi con un clic in meno.
 *
 * Collaudo del 15/10, secondo giro: la scelta di partenza del modulo stava in
 * una riga della pagina, e cambiarla da BONIFICO a CREDITO lasciava verdi
 * tutte le 4350 prove. Qui la pagina vera viene MONTATA, con lo stato e gli
 * effetti, e si guarda cosa trova il cliente e cosa parte se preme «Invia»
 * senza scegliere niente.
 */

let Pagina: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  const modulo = await monta('app/orders/[id]/return/page.tsx');
  Pagina = modulo.default as ComponentType<Record<string, unknown>>;
}, 60000);

/** Le richieste che la pagina manda al server: qui non parte niente davvero. */
const richieste: Array<{ url: string; corpo: Record<string, unknown> }> = [];

/** Un maglione da 40 € pagato in contanti al fattorino, consegnato ieri. */
const ORDINE = {
  id: 'o1',
  total_price: 40,
  delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
  delivery_status: 'DELIVERED',
  payment_method: 'cod',
  stripe_payment_intent: null,
};

beforeEach(() => {
  richieste.length = 0;
  const g = globalThis as Record<string, unknown>;
  g.__PARAMETRI_FINTI__ = { id: 'o1' };
  g.__RISPOSTA_SUPABASE__ = ({ tavola }: { tavola: string }) =>
    tavola === 'orders' ? { data: ORDINE, error: null } : { data: [], error: null };
  vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
    richieste.push({ url: String(url), corpo: JSON.parse(init?.body ?? '{}') });
    return new Response(JSON.stringify({ id: 'r1', sceltaDelRimborso: 'salvata' }), { status: 201 });
  });
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__PARAMETRI_FINTI__;
  delete g.__RISPOSTA_SUPABASE__;
  vi.unstubAllGlobals();
});

async function apriIlModulo() {
  const s = accendi(Pagina);
  // La pagina legge l'ordine in un effetto: si lascia arrivare la risposta.
  for (let i = 0; i < 5; i++) await attendi();
  const radio = (valore: string) =>
    s.radice.querySelector<HTMLInputElement>(`input[type="radio"][name="modo-rimborso"][value="${valore}"]`);
  return { s, radio };
}

describe('come vuoi il rimborso? — chi ha pagato in contanti', () => {
  it('la domanda c e, e la scelta gia segnata e il bonifico', async () => {
    const { s, radio } = await apriIlModulo();

    expect(radio('BONIFICO'), 'il modulo di reso non chiede come riavere i soldi').not.toBeNull();
    expect(radio('BONIFICO')!.checked, 'il bonifico non e la scelta di partenza').toBe(true);
    expect(radio('CREDITO')!.checked, 'il credito MyCity e gia spuntato: non e un consenso espresso').toBe(false);
    s.smonta();
  });

  it('chi preme «Invia» senza toccare niente non chiede il credito: gli si chiede l IBAN', async () => {
    const { s } = await apriIlModulo();
    const invia = Array.from(s.radice.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Invia richiesta di reso'),
    );
    expect(invia).toBeTruthy();

    s.agisci(() => clicca(invia!));
    for (let i = 0; i < 3; i++) await attendi();

    const colCredito = richieste.filter((r) => (r.corpo.rimborso as { modo?: string } | undefined)?.modo === 'CREDITO');
    expect(colCredito, 'un clic su «Invia» ha chiesto il credito MyCity al posto dei soldi').toHaveLength(0);
    expect(s.radice.textContent ?? '', 'manca la richiesta dell IBAN per il bonifico').toMatch(/IBAN/);
    s.smonta();
  });
});
