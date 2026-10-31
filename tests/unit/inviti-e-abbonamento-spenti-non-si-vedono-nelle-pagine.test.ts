/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 31/10/2026 — INVITI E ABBONAMENTO SPENTI AL LANCIO: LE PAGINE VERE NON LI PROMETTONO.
 *
 * ① Il link «invita un amico» apriva l'iscrizione con «Codice … applicato», ma l'invito non si
 *    registrava mai: la pagina cercava chi aveva invitato leggendo `profiles` dal browser di una
 *    persona senza account, e le regole del database non lo permettono. Chi invitava non riceveva
 *    i 5 euro. Al lancio inviti e punti sono spenti (carta #209): `INVITI_E_PUNTI_ACCESI`.
 * ② L'abbonamento da 50 € al mese e le sponsorizzate sono sospesi (`ABBONAMENTO_NEGOZI_ACCESO`):
 *    il pannello del negozio non deve invitarlo a pagare una cosa che la rotta rifiuta.
 *
 * Qui le pagine VERE si montano e si legge quello che vede la persona.
 */

type Pagina = ComponentType<Record<string, unknown>>;
type G = Record<string, unknown> & { __QUERY_FINTA__?: string; __RISPOSTA_SUPABASE__?: unknown };
const g = globalThis as unknown as G;

let Registrazione: Pagina;
let Inviti: Pagina;
let Sponsorizza: Pagina;
let Banner: Pagina;

beforeAll(async () => {
  const [r, i, s, b] = await Promise.all([
    monta('app/sign-up/page.tsx'),
    monta('app/profile/referral/page.tsx'),
    monta('app/seller/promote/page.tsx'),
    monta('components/seller/SubscriptionBanner.tsx'),
  ]);
  Registrazione = r.default as Pagina;
  Inviti = i.default as Pagina;
  Sponsorizza = s.default as Pagina;
  Banner = b.SubscriptionBanner as Pagina;
}, 120000);

const montate: Array<{ smonta: () => void }> = [];
const letture: Array<{ tavola: string; colonne: string }> = [];

function apri(Pagina: Pagina, percorso: string, proprieta: Record<string, unknown> = {}) {
  const [path, query = ''] = percorso.split('?');
  window.history.replaceState(null, '', percorso);
  g.__QUERY_FINTA__ = query;
  (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = path;
  const s = accendi(Pagina, proprieta);
  montate.push(s);
  return s;
}

async function aspettaChe(vero: () => boolean, ms = 3000): Promise<void> {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (vero()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

beforeEach(() => {
  letture.length = 0;
  g.__RISPOSTA_SUPABASE__ = (q: { tavola: string; colonne: string }) => {
    letture.push(q);
    return { data: [{ id: 'amico-1', referral_code: 'AMICO5', full_name: 'Luca' }], error: null };
  };
});
afterEach(() => {
  while (montate.length) montate.pop()!.smonta();
  delete g.__RISPOSTA_SUPABASE__;
});

describe('inviti spenti al lancio', () => {
  it("l'iscrizione da un link d'invito non scrive «Codice applicato» e non cerca chi ha invitato", async () => {
    const s = apri(Registrazione, '/sign-up?ref=AMICO5');
    await aspettaChe(() => !!s.radice.querySelector('#signup-email'));
    expect(s.radice.querySelector('#signup-email'), 'il modulo di iscrizione non si è disegnato').not.toBeNull();
    const testo = testoVisibile(s.radice);
    expect(testo).not.toMatch(/applicato/i);
    expect(testo).not.toMatch(/AMICO5/);
    expect(testo).not.toMatch(/Sei stato invitato/i);
    expect(letture.filter((l) => l.tavola === 'profiles')).toHaveLength(0);
  });

  it('la pagina «invita un amico» non dà un link che promette 5 euro', async () => {
    const s = apri(Inviti, '/profile/referral');
    await aspettaChe(() => /non sono ancora attivi/i.test(testoVisibile(s.radice)));
    const testo = testoVisibile(s.radice);
    expect(testo).toMatch(/inviti non sono ancora attivi/i);
    expect(testo).not.toMatch(/ricevi €5/i);
    expect(s.radice.innerHTML).not.toMatch(/sign-up\?ref=/);
  });
});

describe('abbonamento e sponsorizzate sospesi al lancio', () => {
  it('il banner del pannello negozio non invita a pagare i 50 € al mese', async () => {
    const s = apri(Banner, '/seller', { status: null });
    await aspettaChe(() => false, 100);
    expect(testoVisibile(s.radice)).toBe('');
    expect(s.radice.querySelector('button')).toBeNull();
  });

  it('«Sponsorizza» dice che è sospesa e non offre il pagamento', async () => {
    const s = apri(Sponsorizza, '/seller/promote');
    await aspettaChe(() => /non sono attive/i.test(testoVisibile(s.radice)));
    const testo = testoVisibile(s.radice);
    expect(testo).toMatch(/sponsorizzate non sono attive/i);
    expect(testo).not.toMatch(/4,99/);
    expect(s.radice.querySelector('button')).toBeNull();
  });
});
