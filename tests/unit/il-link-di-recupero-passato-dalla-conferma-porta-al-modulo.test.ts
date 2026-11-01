// @vitest-environment jsdom
/**
 * Collaudo S4 lente B: contratto del rientro col link di recupero passato da /auth/confirm.
 *
 * Adattata al segno messo dal server: /auth/confirm, dopo un verifyOtp di tipo
 * recovery riuscito, firma un biscotto httpOnly; la pagina lo chiede a
 * /auth/recupero. Qui la risposta di quella rotta la decide la prova.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { destinazioneDopoLaConferma, leggiLinkDiConferma, PAGINA_NUOVA_PASSWORD } from '@/lib/auth/link-email';

type Pagina = ComponentType<Record<string, unknown>>;
type G = Record<string, unknown> & {
  __QUERY_FINTA__?: string;
  __UTENTE__?: unknown;
  __GETTONE__?: string;
  __AUTH_FINTA__?: Record<string, (...a: unknown[]) => unknown>;
  __ASCOLTI_AUTH__?: Array<(evento: string, sessione: unknown) => void>;
  __NAVIGAZIONI__?: unknown[];
};
const g = globalThis as unknown as G;

let NuovaPassword: Pagina;
beforeAll(async () => {
  NuovaPassword = (await monta('app/reset-password/page.tsx')).default as Pagina;
}, 120000);

const montate: Array<{ smonta: () => void }> = [];
let chiamateUpdate: unknown[] = [];
let domandeAlServer: string[] = [];
let ilServerDice = false;
const reteDiPrima = globalThis.fetch;

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function gettone(metodo: string, secondiFa = 30): string {
  const ora = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'u1', amr: [{ method: metodo, timestamp: ora - secondiFa }] })}.firma`;
}

function apri() {
  window.history.replaceState(null, '', '/reset-password');
  g.__QUERY_FINTA__ = '';
  (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = '/reset-password';
  const s = accendi(NuovaPassword);
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

function moduloPassword(radice: HTMLElement): HTMLFormElement | null {
  return ([...radice.querySelectorAll('form')].find((f) => !f.querySelector('#reset-request-email')) ?? null) as HTMLFormElement | null;
}

function scrivi(campo: HTMLInputElement, valore: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  void act(() => {
    setter.call(campo, valore);
    campo.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

async function provaACambiare(radice: HTMLElement) {
  const modulo = moduloPassword(radice);
  if (!modulo) return;
  const campi = [...modulo.querySelectorAll('input')] as HTMLInputElement[];
  for (const c of campi) scrivi(c, 'NuovaPassword-2026!');
  await act(async () => {
    modulo.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 50));
  });
}

beforeEach(() => {
  chiamateUpdate = [];
  domandeAlServer = [];
  ilServerDice = false;
  globalThis.fetch = (async (input: unknown) => {
    const dove = String(input);
    if (dove === '/auth/recupero') {
      domandeAlServer.push(dove);
      return new Response(JSON.stringify({ recupero: ilServerDice }), { status: 200 });
    }
    return reteDiPrima(input as RequestInfo);
  }) as typeof fetch;
  g.__NAVIGAZIONI__ = [];
  g.__ASCOLTI_AUTH__ = [];
  g.__AUTH_FINTA__ = {
    updateUser: (...a: unknown[]) => {
      chiamateUpdate.push(a);
      return { data: { user: { id: 'u1' } }, error: null };
    },
  };
  g.__UTENTE__ = { id: 'u1', email: 'maria@example.com' };
});

afterEach(() => {
  while (montate.length) montate.pop()!.smonta();
  globalThis.fetch = reteDiPrima;
  delete g.__QUERY_FINTA__;
  delete g.__AUTH_FINTA__;
  delete g.__UTENTE__;
  delete g.__GETTONE__;
  delete g.__ASCOLTI_AUTH__;
  delete g.__NAVIGAZIONI__;
});

describe('contratto: il link passato da /auth/confirm porta al modulo', () => {
  it('sessione nei cookie aperta da verifyOtp (metodo otp) col segno del server: si sceglie la password', async () => {
    const link = leggiLinkDiConferma(new URLSearchParams('token_hash=abcdef0123456789&type=recovery'));
    if (link.valido) expect(destinazioneDopoLaConferma('https://mycity.test', link).pathname).toBe(PAGINA_NUOVA_PASSWORD);
    g.__GETTONE__ = gettone('otp', 5);
    ilServerDice = true;
    const s = apri();
    await aspettaChe(() => !!moduloPassword(s.radice), 4000);
    expect(moduloPassword(s.radice), 'chi arriva da /auth/confirm non trova il modulo della nuova password').not.toBeNull();
    await provaACambiare(s.radice);
    expect(chiamateUpdate).toHaveLength(1);
  }, 30000);

  it('una sessione otp SENZA il segno del server non cambia la password', async () => {
    g.__GETTONE__ = gettone('otp', 5);
    ilServerDice = false;
    const s = apri();
    await aspettaChe(() => domandeAlServer.length > 0, 4000);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200));
    });
    expect(domandeAlServer.length, 'la pagina non ha chiesto il segno al server').toBeGreaterThan(0);
    await provaACambiare(s.radice);
    expect(chiamateUpdate).toHaveLength(0);
  }, 30000);

  it('chi è entrato con la password non chiede nemmeno il segno e non cambia la password', async () => {
    g.__GETTONE__ = gettone('password', 5);
    ilServerDice = true;
    const s = apri();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200));
    });
    await provaACambiare(s.radice);
    expect(domandeAlServer).toHaveLength(0);
    expect(chiamateUpdate).toHaveLength(0);
  }, 30000);
});
