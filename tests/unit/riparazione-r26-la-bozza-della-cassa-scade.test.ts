/**
 * @vitest-environment jsdom
 */
/**
 * 26/11/2026 (R26-016) — «HO GIÀ UN ACCOUNT» NON LASCIA I DATI DI UN OSPITE NEL BROWSER PER SEMPRE.
 *
 * Il tocco su «Ho già un account» salva la bozza della cassa (nome, via, telefono, note) nel
 * localStorage, perché chi torna dall'accesso ritrovi quello che ha scritto. Non scadeva: un ospite
 * su un computer condiviso compila, tocca il link e rinuncia; una settimana dopo chi apre la cassa
 * su quel browser trova già scritti nome, indirizzo e telefono dell'ospite.
 *
 * Qui la cassa si MONTA intera, con l'orologio finto: l'ospite scrive l'indirizzo e tocca il link,
 * poi la cassa si riapre dopo il tempo detto. Entro due ore la bozza torna; dopo, non torna e
 * sparisce dal browser.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, info: () => undefined, error: () => undefined, warning: () => undefined }),
}));

const g = globalThis as Record<string, unknown>;
const MARIA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it' };
const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FILONE = { id: 'p-filone', name: 'Filone', price: 15, quantity: 1, sellerId: PANE, storeName: 'Pane Quotidiano' };
const GRUPPI = { groups: [{ sellerId: PANE, storeName: 'Pane Quotidiano', storeLat: 45.0526, storeLng: 9.693, items: [FILONE] }], orphans: [], stockIssues: [], variantIssues: [], prezziCambiati: [] };
/** Giovedì 26/11/2026 alle 16:00 di Roma. */
const ALLE_16 = Date.parse('2026-11-26T15:00:00Z');
const MINUTO = 60_000;

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  delete g.__DATI_QUERY__;
  delete g.__UTENTE__;
});

async function assesta(n = 12) {
  for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** La cassa aperta all'istante detto, da ospite (`chi` = null) o da Maria. */
async function apriLaCassa(istante: number, chi: typeof MARIA | null) {
  vi.setSystemTime(new Date(istante));
  localStorage.setItem('cart', JSON.stringify([FILONE]));
  g.__UTENTE__ = chi ?? undefined;
  g.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [cosa] = o.queryKey;
    if (cosa === 'checkout-groups') return GRUPPI;
    if (cosa === 'auth-user') return chi;
    if (cosa === 'user-addresses') return [];
    return undefined;
  };
  const pagina = (await monta('app/checkout/page.tsx')).default;
  schermo = accendi(pagina, {});
  await assesta();
  return schermo.radice;
}

function chiudiLaCassa() {
  schermo?.smonta();
  schermo = null;
}

const campo = (r: HTMLElement, nome: string) => r.querySelector<HTMLInputElement>(`#checkout-form input[name="${nome}"]`)!;

async function scrivi(r: HTMLElement, nome: string, valore: string) {
  const el = campo(r, nome);
  expect(el, `il campo «${nome}» non si trova: la prova non misurerebbe niente`).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, valore);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

/** L'ospite scrive nome, via e telefono e tocca «Ho già un account» alle 16:00. */
async function ospiteToccaHoGiaUnAccount() {
  const r = await apriLaCassa(ALLE_16, null);
  await scrivi(r, 'fullName', 'Anna Bianchi');
  await scrivi(r, 'address', 'Via Roma 10');
  await scrivi(r, 'phone', '3339876543');
  const link = [...r.querySelectorAll('a')].find((a) => /Ho già un account/.test(a.textContent ?? ''));
  expect(link, 'il link «Ho già un account» non si trova').toBeTruthy();
  link!.addEventListener('click', (e) => e.preventDefault()); // jsdom non naviga
  await act(async () => clicca(link!));
  const salvata = localStorage.getItem('mc_checkout_draft');
  expect(salvata, 'il link non ha salvato la bozza: la prova non misurerebbe niente').toMatch(/Via Roma 10/);
  chiudiLaCassa();
}

describe('R26-016 · la bozza lasciata da «Ho già un account» scade dopo due ore', () => {
  it('riaperta un\'ora e mezza dopo, la cassa rimette quello che l\'ospite aveva scritto', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    await ospiteToccaHoGiaUnAccount();
    const r = await apriLaCassa(ALLE_16 + 90 * MINUTO, MARIA);
    expect(campo(r, 'address').value).toBe('Via Roma 10');
    expect(campo(r, 'phone').value).toBe('3339876543');
  }, 60_000);

  it('riaperta una settimana dopo, nome, via e telefono dell\'ospite non tornano e spariscono dal browser', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    await ospiteToccaHoGiaUnAccount();
    const r = await apriLaCassa(ALLE_16 + 7 * 24 * 60 * MINUTO, MARIA);
    expect(campo(r, 'address').value, 'la cassa ha rimesso la via di un ospite di una settimana fa').toBe('');
    expect(campo(r, 'fullName').value).not.toBe('Anna Bianchi');
    expect(campo(r, 'phone').value).not.toBe('3339876543');
    expect(localStorage.getItem('mc_checkout_draft'), 'la bozza scaduta è rimasta nel browser').toBeNull();
  }, 60_000);

  it('due ore e un minuto dopo è già scaduta', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    await ospiteToccaHoGiaUnAccount();
    const r = await apriLaCassa(ALLE_16 + 121 * MINUTO, null);
    expect(campo(r, 'address').value).toBe('');
    expect(localStorage.getItem('mc_checkout_draft')).toBeNull();
  }, 60_000);

  it('una bozza con l\'ora nel futuro (orologio spostato) non vale per sempre', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(ALLE_16));
    localStorage.setItem('mc_checkout_draft', JSON.stringify({
      form: { fullName: 'Anna Bianchi', address: 'Via Roma 10', city: 'Piacenza', zip: '29121', phone: '3339876543', notes: '' },
      metodoPagamento: 'cod',
      sceltaIl: ALLE_16 + 30 * 24 * 60 * MINUTO,
    }));
    const r = await apriLaCassa(ALLE_16, MARIA);
    expect(campo(r, 'address').value).toBe('');
    expect(localStorage.getItem('mc_checkout_draft')).toBeNull();
  }, 60_000);
});
