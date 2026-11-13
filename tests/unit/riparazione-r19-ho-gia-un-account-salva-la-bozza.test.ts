/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

const src = readFileSync('app/checkout/page.tsx', 'utf8');

describe('R19-004 · «Ho già un account» salva la bozza prima di uscire', () => {
  it('il link verso l\'accesso ha un onClick che salva la bozza', () => {
    const m = src.match(/<Link href="\/sign-in\?returnTo=\/checkout"([^>]*)>/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/onClick=\{salvaLaBozzaPerAccesso\}/);
  });
  it('il salvataggio passa da bozzaDaSalvare (con la scadenza) ed è lo stesso di «Ordina»', () => {
    const i = src.indexOf('const salvaLaBozzaPerAccesso');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 700)).toMatch(/localStorage\.setItem\('mc_checkout_draft', JSON\.stringify\(bozzaDaSalvare\(/);
    const h = src.indexOf('const handleSubmit');
    expect(src.slice(h)).toMatch(/if \(!authUser\) \{[\s\S]{0,900}salvaLaBozzaPerAccesso\(\);\s*router\.push\('\/sign-in\?returnTo=\/checkout'\)/);
  });
});

/**
 * Giro di correzione (13/11): con un indirizzo già salvato la bozza tornava, ma il modulo
 * restava nascosto dietro le mattonelle e nessuna era scelta: si ordinava su un indirizzo che
 * non si vedeva. Qui si monta la cassa vera, come chi rientra dall'accesso.
 */
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, info: () => undefined, error: () => undefined, warning: () => undefined }),
}));

const g = globalThis as Record<string, unknown>;
const MARIA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it' };
const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FILONE = { id: 'p-filone', name: 'Filone', price: 15, quantity: 1, sellerId: PANE, storeName: 'Pane Quotidiano' };
const GRUPPI = { groups: [{ sellerId: PANE, storeName: 'Pane Quotidiano', storeLat: 45.0526, storeLng: 9.693, items: [FILONE] }], orphans: [], stockIssues: [], variantIssues: [], prezziCambiati: [] };
const CASA = { id: 'ind-casa', user_id: MARIA.id, full_name: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: null, lat: 45.0526, lng: 9.7, is_default: true };

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  sessionStorage.clear();
  delete g.__DATI_QUERY__;
  delete g.__UTENTE__;
});

async function assesta(n = 12) {
  for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Maria rientra dall'accesso: la bozza scritta da ospite è nel browser, e lei ha `indirizzi` salvati. */
async function rientraConLaBozza(indirizzi: unknown[], campi: Record<string, unknown>) {
  const adesso = Date.now();
  localStorage.setItem('cart', JSON.stringify([FILONE]));
  localStorage.setItem('mc_checkout_draft', JSON.stringify({
    form: { fullName: 'Maria Rossi', address: 'Via Roma 10', city: 'Piacenza', zip: '29121', phone: '3339876543', notes: '', lat: null, lng: null, ...campi },
    metodoPagamento: 'cod',
    sceltaIl: adesso,
    scadeIl: adesso + 60 * 60_000,
  }));
  g.__UTENTE__ = MARIA;
  g.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [chi] = o.queryKey;
    if (chi === 'checkout-groups') return GRUPPI;
    if (chi === 'auth-user') return MARIA;
    if (chi === 'user-addresses') return indirizzi;
    return undefined;
  };
  const pagina = (await monta('app/checkout/page.tsx')).default;
  schermo = accendi(pagina, {});
  await assesta();
  return schermo.radice;
}

/** L'indirizzo su cui partirebbe l'ordine (quello del modulo, visibile o no). */
const indirizzoDellOrdine = (r: HTMLElement) => r.querySelector<HTMLInputElement>('#checkout-form input[name="address"]')!.value;
const moduloVisibile = (r: HTMLElement) => !r.querySelector('#checkout-form')!.classList.contains('hidden');
/** Le mattonelle scelte del passo 1: stanno nello stesso blocco del modulo dell'indirizzo. */
const mattonelleScelte = (r: HTMLElement) => [...r.querySelector('#checkout-form')!.parentElement!.querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]')];

describe('R19-004 · montata: chi ha già indirizzi salvati vede dove arriva l\'ordine dopo l\'accesso', () => {
  it('la via scritta da ospite torna e si vede: o nel modulo aperto, o in una mattonella scelta', async () => {
    const r = await rientraConLaBozza([CASA], {});
    expect(indirizzoDellOrdine(r)).toBe('Via Roma 10');
    const scelte = mattonelleScelte(r);
    const siVede = moduloVisibile(r) || (scelte.length === 1 && /Via Roma 10/.test(scelte[0].textContent ?? ''));
    expect(siVede, 'si ordinerebbe su «Via Roma 10» senza vederlo').toBe(true);
  }, 60000);

  it('si può passare all\'indirizzo salvato e tornare a quello scritto da ospite', async () => {
    const r = await rientraConLaBozza([CASA], {});
    const casa = [...r.querySelectorAll('button')].find((b) => /Via Verdi 10/.test(b.textContent ?? ''))!;
    clicca(casa);
    await assesta(3);
    expect(indirizzoDellOrdine(r)).toBe('Via Verdi 10');
    expect(mattonelleScelte(r).map((b) => b.textContent)).toEqual([expect.stringContaining('Via Verdi 10')]);
    const scritta = [...r.querySelectorAll('button')].find((b) => /Via Roma 10/.test(b.textContent ?? ''));
    expect(scritta, 'l\'indirizzo scritto da ospite è sparito').toBeTruthy();
    clicca(scritta!);
    await assesta(3);
    expect(indirizzoDellOrdine(r)).toBe('Via Roma 10');
    // R19-009 (giro di correzione): l'account ha già i suoi dati, quindi nome e telefono sono i suoi,
    // non quelli scritti da ospite (che potrebbe essere un altro, sullo stesso browser).
    expect(r.querySelector<HTMLInputElement>('#checkout-form input[name="phone"]')!.value).toBe('3331234567');
  }, 60000);

  it('se la bozza è proprio un indirizzo salvato, è quella mattonella a essere scelta (niente doppioni)', async () => {
    const r = await rientraConLaBozza([CASA], { address: 'Via Verdi 10' });
    const scelte = mattonelleScelte(r);
    expect(scelte).toHaveLength(1);
    expect(scelte[0].textContent).toMatch(/Via Verdi 10/);
    expect([...r.querySelectorAll('button')].filter((b) => /Via Verdi 10/.test(b.textContent ?? ''))).toHaveLength(1);
  }, 60000);
});
