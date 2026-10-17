/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * R71 — IL MODULO DI RESO NON CHIEDE COME RIAVERE I CONTANTI: LO DICE.
 *
 * Decisione di Nicola del 17/10/2026 («Semplifica»): chi ha pagato alla consegna
 * riavrà i soldi con un bonifico, sempre. Il modulo non offre il credito MyCity
 * (una scelta che apriva la strada a dare credito al posto dei soldi) e non
 * chiede l'IBAN (che il sito non salva più: lo chiede l'email del rimborso).
 * Resta una riga che informa. Se una pagina vecchia manda ancora la scelta, il
 * server la scarta (i-contanti-tornano-sempre-col-bonifico-da-ogni-strada).
 *
 * La pagina vera viene MONTATA, con lo stato e gli effetti, e si guarda cosa
 * trova il cliente e cosa parte se preme «Invia».
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
  wallet_applied_cents: 0,
};

beforeEach(() => {
  richieste.length = 0;
  const g = globalThis as Record<string, unknown>;
  g.__PARAMETRI_FINTI__ = { id: 'o1' };
  g.__RISPOSTA_SUPABASE__ = ({ tavola }: { tavola: string }) =>
    tavola === 'orders' ? { data: ORDINE, error: null } : { data: [], error: null };
  vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
    richieste.push({ url: String(url), corpo: JSON.parse(init?.body ?? '{}') });
    return new Response(JSON.stringify({ id: 'r1', status: 'REQUESTED' }), { status: 201 });
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
  return s;
}

/** Come PostgREST: tornano solo le colonne chieste. Una colonna che la pagina non legge, non la vede. */
function rispondeCon(ordine: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).__RISPOSTA_SUPABASE__ = ({ tavola, colonne }: { tavola: string; colonne: string }) => {
    if (tavola !== 'orders') return { data: [], error: null };
    const chieste = colonne.split(',').map((c) => c.trim()).filter(Boolean);
    return { data: Object.fromEntries(chieste.map((c) => [c, ordine[c]])), error: null };
  };
}

describe('il modulo di reso di chi ha pagato in contanti', () => {
  it('nessuna scelta e nessun campo IBAN: una riga dice che i soldi tornano col bonifico, e l IBAN si chiede per email', async () => {
    rispondeCon(ORDINE);
    const s = await apriIlModulo();
    const testo = s.radice.textContent ?? '';

    expect(s.radice.querySelectorAll('input[name="modo-rimborso"]'), 'il modulo offre una scelta sul rimborso').toHaveLength(0);
    expect(testo).not.toMatch(/Come vuoi il rimborso|credito MyCity/u);
    expect(s.radice.querySelector('input[autocomplete="off"][maxlength="64"]'), 'il modulo chiede l IBAN').toBeNull();
    expect(testo).toContain('Hai pagato alla consegna: se il reso viene rimborsato, ti restituiamo i soldi con un bonifico.');
    expect(testo).toContain("L'IBAN te lo chiediamo per email, quando parte il rimborso.");
    s.smonta();
  });

  it('chi preme «Invia» manda solo il reso: nessun campo «rimborso» nel corpo', async () => {
    rispondeCon(ORDINE);
    const s = await apriIlModulo();
    const invia = Array.from(s.radice.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Invia richiesta di reso'),
    );
    expect(invia).toBeTruthy();

    s.agisci(() => clicca(invia!));
    for (let i = 0; i < 3; i++) await attendi();

    const alServer = richieste.filter((r) => r.url.includes('/api/returns/create'));
    expect(alServer, 'il modulo non ha mandato la richiesta: la prova non misura niente').toHaveLength(1);
    expect(alServer[0].corpo).toMatchObject({ orderId: 'o1' });
    expect(alServer[0].corpo, 'il modulo manda ancora una scelta sul rimborso').not.toHaveProperty('rimborso');
    s.smonta();
  });

  it('ordine pagato in parte col credito: dice anche che quella parte torna come credito', async () => {
    rispondeCon({ ...ORDINE, total_price: 30, wallet_applied_cents: 2000 });
    const s = await apriIlModulo();
    expect(s.radice.textContent ?? '').toContain('La parte che avevi pagato con il credito MyCity torna come credito.');
    s.smonta();
  });

  it('su un ordine tutto in contanti la frase del credito non c e', async () => {
    rispondeCon({ ...ORDINE, wallet_applied_cents: 0 });
    const s = await apriIlModulo();
    expect(s.radice.textContent ?? '').not.toMatch(/pagato con il credito MyCity/u);
    s.smonta();
  });

  it('pagato con la carta, o tutto col credito: nessuna riga sul bonifico', async () => {
    rispondeCon({ ...ORDINE, payment_method: 'card', stripe_payment_intent: 'pi_1' });
    const carta = await apriIlModulo();
    expect(carta.radice.textContent ?? '').not.toMatch(/bonifico/u);
    carta.smonta();

    rispondeCon({ ...ORDINE, total_price: 0, wallet_applied_cents: 4000 });
    const credito = await apriIlModulo();
    expect(credito.radice.textContent ?? '').not.toMatch(/bonifico/u);
    credito.smonta();
  });
});
