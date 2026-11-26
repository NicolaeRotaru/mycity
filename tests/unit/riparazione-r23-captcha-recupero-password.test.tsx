/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * R23-013 — La richiesta del link per una nuova password porta il gettone anti-robot.
 *
 * Col CAPTCHA acceso su Supabase, `resetPasswordForEmail` senza `captchaToken` viene rifiutato:
 * «Password dimenticata?» nella pagina di accesso e «Invia il link» in /reset-password non
 * mandavano niente. Il gettone vale una volta sola: dopo averlo mandato se ne chiede uno nuovo.
 * Qui si montano le due pagine vere con un riquadro anti-robot finto che dà un gettone nuovo a ogni
 * richiesta, e si guarda cosa arriva a Supabase.
 */
const stato = vi.hoisted(() => ({
  emessi: 0,
  richieste: [] as Array<{ email: string; captchaToken?: string }>,
  /** Se c'è, la richiesta del link resta in corso finché non si scioglie. */
  trattieni: null as Promise<void> | null,
}));
vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'chiave-del-sito');

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: async (email: string, opz?: { captchaToken?: string }) => {
        stato.richieste.push({ email, captchaToken: opz?.captchaToken });
        if (stato.trattieni) await stato.trattieni;
        return { data: {}, error: null };
      },
      initialize: async () => ({ error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      signInWithOAuth: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  },
}));
vi.mock('@/components/Turnstile', async () => {
  const React = await import('react');
  const Finto = React.forwardRef<{ reset: () => void }, { onVerify: (t: string) => void }>(function Finto({ onVerify }, ref) {
    const richiamo = React.useRef(onVerify);
    richiamo.current = onVerify;
    const dai = () => { stato.emessi += 1; richiamo.current(`gettone-${stato.emessi}`); };
    React.useImperativeHandle(ref, () => ({ reset: dai }));
    React.useEffect(() => { dai(); }, []);
    return null;
  });
  return { default: Finto };
});
vi.mock('sonner', () => ({
  toast: { error: () => undefined, success: () => undefined, info: () => undefined, warning: () => undefined },
}));
const router = vi.hoisted(() => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/sign-in',
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...resto }: { children: unknown; href: unknown } & Record<string, unknown>) =>
    createElement('a', { ...resto, href: String(href) }, children as never),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/analytics/events', () => ({ trackSignedIn: () => undefined, trackErrorShown: () => undefined }));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: Accesso } = await import('@/app/sign-in/page');
const { default: NuovaPassword } = await import('@/app/reset-password/page');

const aspetta = async (ms = 0) => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
};

function scrivi(campo: HTMLInputElement, valore: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(campo, valore);
    campo.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

function monta(pagina: () => unknown) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  return {
    div,
    async accendi() { await act(async () => { root.render(createElement(pagina as never)); }); },
    smonta() { act(() => root.unmount()); div.remove(); },
  };
}

beforeEach(() => { stato.emessi = 0; stato.richieste = []; stato.trattieni = null; });

describe('R23-013 — il recupero della password porta il gettone anti-robot', () => {
  it('«Password dimenticata?» nella pagina di accesso manda il gettone, e il secondo invio ne ha uno nuovo', async () => {
    const p = monta(Accesso);
    await p.accendi();
    await aspetta();
    scrivi(p.div.querySelector<HTMLInputElement>('#signin-email')!, 'persona@esempio.it');
    const dimenticata = [...p.div.querySelectorAll('button')].find((b) => /Password dimenticata/.test(b.textContent ?? ''));
    expect(dimenticata, 'controprova: il pulsante deve essere a video').toBeTruthy();
    await act(async () => { dimenticata!.click(); });
    await aspetta();
    await act(async () => { dimenticata!.click(); });
    await aspetta();
    p.smonta();
    expect(stato.richieste.map((r) => r.email)).toEqual(['persona@esempio.it', 'persona@esempio.it']);
    expect(stato.richieste[0].captchaToken, 'la richiesta del link parte senza gettone').toBe('gettone-1');
    expect(stato.richieste[1].captchaToken, 'il gettone già speso viene rimandato').toBe('gettone-2');
  });

  it('«Invia il link» in /reset-password manda il gettone', async () => {
    window.history.replaceState(null, '', '/reset-password');
    const p = monta(NuovaPassword);
    await p.accendi();
    // La pagina aspetta 800 ms una sessione di recupero, poi mostra la richiesta del link.
    for (let i = 0; i < 40 && !p.div.querySelector('#reset-request-email'); i++) await aspetta(25);
    const campo = p.div.querySelector<HTMLInputElement>('#reset-request-email');
    expect(campo, 'controprova: la vista «richiedi link» deve essere a video').toBeTruthy();
    scrivi(campo!, 'persona@esempio.it');
    const modulo = campo!.closest('form')!;
    await act(async () => { modulo.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    await aspetta();
    p.smonta();
    expect(stato.richieste).toHaveLength(1);
    expect(stato.richieste[0].captchaToken, 'la richiesta del link parte senza gettone').toBe('gettone-1');
  });

  it('«Accedi» premuto mentre la richiesta del link è in corso non rimanda lo stesso gettone', async () => {
    let sciogli: () => void = () => undefined;
    stato.trattieni = new Promise<void>((r) => { sciogli = r; });
    const accessi: Array<string | undefined> = [];
    vi.stubGlobal('fetch', async (_u: string, init?: { body?: string }) => {
      accessi.push(JSON.parse(init?.body ?? '{}').captchaToken);
      return new Promise(() => {});
    });
    const p = monta(Accesso);
    await p.accendi();
    await aspetta();
    scrivi(p.div.querySelector<HTMLInputElement>('#signin-email')!, 'persona@esempio.it');
    scrivi(p.div.querySelector<HTMLInputElement>('#signin-password')!, 'giusta123');
    const dimenticata = [...p.div.querySelectorAll('button')].find((b) => /Password dimenticata/.test(b.textContent ?? ''));
    const modulo = p.div.querySelector<HTMLFormElement>('form')!;
    await act(async () => { dimenticata!.click(); });
    await aspetta();
    await act(async () => { modulo.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    await aspetta();
    sciogli();
    await aspetta();
    await act(async () => { modulo.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    await aspetta();
    p.smonta();
    vi.unstubAllGlobals();
    expect(stato.richieste.map((r) => r.captchaToken)).toEqual(['gettone-1']);
    expect(accessi, 'l\'accesso ha rimandato il gettone già speso dalla richiesta del link').not.toContain('gettone-1');
    expect(accessi.at(-1), 'controprova: finita la richiesta, l\'accesso parte col gettone nuovo').toBe('gettone-2');
  });

  it('un secondo «Invia il link» mentre il primo è in corso non rimanda lo stesso gettone', async () => {
    let sciogli: () => void = () => undefined;
    stato.trattieni = new Promise<void>((r) => { sciogli = r; });
    window.history.replaceState(null, '', '/reset-password');
    const p = monta(NuovaPassword);
    await p.accendi();
    for (let i = 0; i < 40 && !p.div.querySelector('#reset-request-email'); i++) await aspetta(25);
    const campo = p.div.querySelector<HTMLInputElement>('#reset-request-email');
    expect(campo, 'controprova: la vista «richiedi link» deve essere a video').toBeTruthy();
    scrivi(campo!, 'persona@esempio.it');
    const modulo = campo!.closest('form')!;
    await act(async () => { modulo.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    await act(async () => { modulo.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    sciogli();
    await aspetta();
    p.smonta();
    expect(stato.richieste).toHaveLength(2);
    expect(stato.richieste[0].captchaToken).toBe('gettone-1');
    expect(stato.richieste[1].captchaToken, 'il secondo invio ha rimandato il gettone già speso').not.toBe('gettone-1');
  });
});
