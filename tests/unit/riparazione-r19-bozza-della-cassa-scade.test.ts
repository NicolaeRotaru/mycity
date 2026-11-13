/**
 * @vitest-environment jsdom
 */
/**
 * 13/11/2026 (R19-009) — NOME, TELEFONO E INDIRIZZO DI CHI NON COMPLETA L'ACCESSO RESTAVANO NEL BROWSER.
 *
 * Anna compila la cassa da ospite sul computer di casa, preme «Conferma» e chiude quando le chiede
 * di accedere. La cassa aveva salvato nella memoria permanente del browser nome, indirizzo,
 * telefono e note, senza scadenza: si cancellavano solo riaprendo la cassa. Una settimana dopo il
 * fratello entra col suo account, apre la cassa e trova il modulo già scritto coi dati di Anna.
 *
 * Qui si mette in scena tutto con l'orologio finto: la cassa vera, montata, che salva la bozza; la
 * cassa riaperta da un altro dopo due ore (dati spariti, e la bozza tolta dal browser) e da Anna
 * dopo un'ora (dati ritrovati, come prima); la barra in alto vera, che butta la bozza scaduta a ogni
 * caricamento e ogni bozza all'uscita dall'account; e la Cookie policy, che adesso la dichiara.
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, info: () => undefined, warning: () => undefined, error: () => undefined }),
  Toaster: () => null,
}));

const globale = globalThis as Record<string, unknown>;
const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FRATELLO = { id: 'dddddddd-4444-4444-8444-dddddddddddd', email: 'marco@test.it' };
const BOZZA = 'mc_checkout_draft';
/** Giovedì 29/10/2026 alle 10:00 di Roma. */
const GIOVEDI_10 = new Date('2026-10-29T09:00:00Z');
const MINUTO = 60_000;

const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (url.includes('/api/consegna/veloce')) return { ok: true, json: async () => ({ possibile: false, perche: 'finto' }) };
  return { ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null };
}) as unknown as typeof fetch;

const fusoDiPartenza = process.env.TZ;
afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  for (const k of ['__DATI_QUERY__', '__UTENTE__', '__NAVIGAZIONI__', '__ASCOLTI_AUTH__', '__PROFILO__', '__RISPOSTA_SUPABASE__']) delete globale[k];
  if (fusoDiPartenza === undefined) delete process.env.TZ;
  else process.env.TZ = fusoDiPartenza;
});
afterAll(() => {
  globalThis.fetch = reteDiPartenza;
});

async function assesta() {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const filone = { id: 'p-filone', name: 'Filone', price: 15, quantity: 1, sellerId: PANE, storeName: 'Pane Quotidiano' };
const gruppi = {
  groups: [{ sellerId: PANE, storeName: 'Pane Quotidiano', storeLat: null, storeLng: null, items: [filone] }],
  orphans: [],
  stockIssues: [],
  variantIssues: [],
  prezziCambiati: [],
};

/** Apre la cassa: `chi` = null per un ospite, altrimenti la persona entrata. */
async function apriLaCassa(chi: { id: string; email: string } | null) {
  localStorage.setItem('cart', JSON.stringify([filone]));
  if (chi) globale.__UTENTE__ = chi;
  else delete globale.__UTENTE__;
  globale.__NAVIGAZIONI__ = [];
  globale.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [cosa, quale] = o.queryKey;
    if (cosa === 'checkout-groups') return String(quale).includes('p-filone') ? gruppi : undefined;
    if (cosa === 'auth-user') return chi;
    if (cosa === 'user-addresses') return [];
    return undefined;
  };
  const pagina = (await monta('app/checkout/page.tsx')).default;
  const s = accendi(pagina, {});
  await assesta();
  const campo = (nome: string) => s.radice.querySelector<HTMLInputElement>(`input[name="${nome}"]`);
  return {
    campo,
    scrivi: async (nome: string, valore: string) => {
      const c = campo(nome);
      expect(c, `il campo «${nome}» non si trova`).not.toBeNull();
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(c, valore);
        c!.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    },
    conferma: async () => {
      const modulo = s.radice.querySelector('form#checkout-form');
      expect(modulo, 'il modulo della cassa non si trova').not.toBeNull();
      await act(async () => {
        modulo!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      });
      await assesta();
    },
    chiudi: () => s.smonta(),
  };
}

/** Anna, ospite, compila la cassa e preme «Conferma»: la cassa salva la bozza e la manda all'accesso. */
async function annaVaAllAccesso() {
  process.env.TZ = 'Europe/Rome';
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(GIOVEDI_10);
  const c = await apriLaCassa(null);
  await c.scrivi('fullName', 'Anna Bianchi');
  await c.scrivi('address', 'Via Garibaldi 5');
  await c.scrivi('phone', '3339876543');
  await c.conferma();
  expect(
    (globale.__NAVIGAZIONI__ as Array<{ dove: string }>).some((n) => n.dove.startsWith('/sign-in')),
    'la cassa non ha mandato Anna all’accesso: la prova non misurerebbe niente',
  ).toBe(true);
  expect(localStorage.getItem(BOZZA), 'la cassa non ha salvato la bozza: la prova non misurerebbe niente').toContain('Anna Bianchi');
  c.chiudi();
}

describe('R19-009 · la bozza della cassa scade e non passa a chi viene dopo', () => {
  it('due ore dopo il fratello apre la cassa: il modulo è vuoto e la bozza di Anna non è più nel browser', async () => {
    await annaVaAllAccesso();
    vi.setSystemTime(new Date(GIOVEDI_10.getTime() + 2 * 60 * MINUTO + MINUTO));
    const c = await apriLaCassa(FRATELLO);
    expect(c.campo('fullName')?.value, 'il fratello trova il nome di Anna già scritto').toBe('');
    expect(c.campo('phone')?.value, 'il fratello trova il telefono di Anna già scritto').toBe('');
    expect(c.campo('address')?.value).not.toBe('Via Garibaldi 5');
    expect(localStorage.getItem(BOZZA), 'la bozza scaduta resta nel browser coi dati di Anna').toBeNull();
    c.chiudi();
  }, 30_000);

  it('dopo un’ora Anna torna dall’accesso e ritrova quello che aveva scritto, come prima', async () => {
    await annaVaAllAccesso();
    vi.setSystemTime(new Date(GIOVEDI_10.getTime() + 60 * MINUTO));
    const c = await apriLaCassa({ id: 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee', email: 'anna@test.it' });
    expect(c.campo('fullName')?.value).toBe('Anna Bianchi');
    expect(c.campo('phone')?.value).toBe('3339876543');
    expect(localStorage.getItem(BOZZA), 'ripresa, la bozza si cancella').toBeNull();
    c.chiudi();
  }, 30_000);
});

describe('R19-009 · la barra in alto butta la bozza della cassa', () => {
  function ascolti() {
    return globale.__ASCOLTI_AUTH__ as ((evento: string, sessione: unknown) => void)[];
  }
  async function barra() {
    globale.__PROFILO__ = { isAuthenticated: true, isBuyer: true, profile: { full_name: 'Anna Bianchi' } };
    globale.__UTENTE__ = { id: 'anna' };
    globale.__ASCOLTI_AUTH__ = [];
    globale.__RISPOSTA_SUPABASE__ = { data: [], error: null };
    const mod = await monta('components/Navbar.tsx');
    const s = accendi(mod.default, {});
    for (let i = 0; i < 6; i++) await attendi();
    return s;
  }
  const bozzaCheScade = (scadeIl: number) =>
    JSON.stringify({ form: { fullName: 'Anna Bianchi', phone: '3339876543' }, sceltaIl: scadeIl - 2 * 60 * MINUTO, scadeIl });

  it('a ogni caricamento: la bozza scaduta (o senza scadenza) sparisce, quella fresca resta', async () => {
    localStorage.setItem(BOZZA, bozzaCheScade(Date.now() - MINUTO));
    let s = await barra();
    expect(localStorage.getItem(BOZZA), 'la bozza scaduta resta nel browser finché qualcuno non riapre la cassa').toBeNull();
    s.smonta();

    localStorage.setItem(BOZZA, JSON.stringify({ form: { fullName: 'Anna Bianchi' } }));
    s = await barra();
    expect(localStorage.getItem(BOZZA), 'una bozza senza scadenza non dice quanti giorni ha: va buttata').toBeNull();
    s.smonta();

    localStorage.setItem(BOZZA, bozzaCheScade(Date.now() + 60 * MINUTO));
    s = await barra();
    expect(localStorage.getItem(BOZZA), 'la bozza fresca serve a chi sta accedendo: deve restare').not.toBeNull();
    s.smonta();
  }, 60_000);

  it('all’uscita dall’account la bozza si butta, anche se è fresca', async () => {
    localStorage.setItem(BOZZA, bozzaCheScade(Date.now() + 60 * MINUTO));
    sessionStorage.setItem(BOZZA, bozzaCheScade(Date.now() + 60 * MINUTO));
    const s = await barra();
    expect(localStorage.getItem(BOZZA)).not.toBeNull();
    s.agisci(() => ascolti().forEach((a) => a('SIGNED_OUT', null)));
    for (let i = 0; i < 6; i++) await attendi();
    expect(localStorage.getItem(BOZZA), 'chi esce dall’account lascia la bozza a chi entra dopo').toBeNull();
    expect(sessionStorage.getItem(BOZZA)).toBeNull();
    s.smonta();
  }, 60_000);
});

describe('R19-009 · la Cookie policy dichiara la bozza della cassa', () => {
  it('mc_checkout_draft sta fra gli strumenti strettamente necessari, con la sua durata', () => {
    const policy = readFileSync(join(process.cwd(), 'app/cookies/page.tsx'), 'utf8');
    const necessari = policy.slice(0, policy.indexOf('2.2 Cookie funzionali'));
    const riga = necessari.split('\n').find((r) => r.includes("name: 'mc_checkout_draft'"));
    expect(riga, 'la bozza della cassa non è dichiarata fra gli strettamente necessari').toBeTruthy();
    expect(riga, 'la policy non dice quanto dura (2 ore)').toMatch(/duration: '2 ore'/);
  });
});
