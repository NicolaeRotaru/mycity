/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * R23-011 — L'accesso con Google porta il ritorno alla pagina di partenza anche dall'iscrizione.
 *
 * Dalla pagina di accesso il pulsante Google riceve `returnTo` e lo manda a /auth/callback come
 * `next`. L'iscrizione invece lo monta senza (`<AuthAlternatives condizioniDalModulo={…} />`): chi
 * arrivava dal carrello su /sign-up?returnTo=/checkout e sceglieva Google finiva sulla home invece
 * che alla cassa. Qui si monta il pulsante come lo monta l'iscrizione, con l'indirizzo della pagina,
 * si preme Google e si guarda l'indirizzo di ritorno che parte verso Google.
 */
const stato = vi.hoisted(() => ({ ritorno: '' as string }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithOAuth: async (opz: { options?: { redirectTo?: string } }) => {
        stato.ritorno = String(opz.options?.redirectTo ?? '');
        return { error: null };
      },
    },
  },
}));
vi.mock('sonner', () => ({
  toast: { error: () => undefined, success: () => undefined, info: () => undefined, warning: () => undefined },
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...resto }: { children: unknown; href: unknown } & Record<string, unknown>) =>
    createElement('a', { ...resto, href: String(href) }, children as never),
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { AuthAlternatives } = await import('@/components/ui/AuthShell');

/** Dalla pagina `indirizzo` preme Google; torna il `next` dell'indirizzo di ritorno (o null). */
async function premiGoogle(indirizzo: string, props: { condizioniDalModulo?: boolean; returnTo?: string }): Promise<string | null> {
  window.history.replaceState(null, '', indirizzo);
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => { root.render(<AuthAlternatives {...props} />); });
  const google = [...div.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Google');
  expect(google, 'controprova: il pulsante Google deve essere a video').toBeTruthy();
  await act(async () => { google!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  act(() => root.unmount());
  div.remove();
  expect(stato.ritorno, 'controprova: il pulsante deve partire verso Google').not.toBe('');
  const url = new URL(stato.ritorno);
  expect(url.pathname).toBe('/auth/callback');
  return url.searchParams.get('next');
}

beforeEach(() => { stato.ritorno = ''; });

describe('R23-011 — con Google dall\'iscrizione si torna alla pagina di partenza', () => {
  it('IL CASO DELLA VOCE — da /sign-up?returnTo=/checkout si torna alla cassa', async () => {
    expect(await premiGoogle('/sign-up?returnTo=%2Fcheckout', { condizioniDalModulo: true })).toBe('/checkout');
  });

  it('la query del ritorno resta (?tab=…)', async () => {
    const ritorno = encodeURIComponent('/profile/settings?tab=danger');
    expect(await premiGoogle(`/sign-up?returnTo=${ritorno}`, { condizioniDalModulo: true })).toBe('/profile/settings?tab=danger');
  });

  it('un ritorno verso un altro sito non parte', async () => {
    expect(await premiGoogle('/sign-up?returnTo=%2F%2Fsito-cattivo.example%2Fx', { condizioniDalModulo: true })).toBeNull();
  });

  it('senza ritorno nell\'indirizzo non si aggiunge niente', async () => {
    expect(await premiGoogle('/sign-up', { condizioniDalModulo: true })).toBeNull();
  });

  it('il ritorno passato dalla pagina (l\'accesso) vale sopra l\'indirizzo', async () => {
    expect(await premiGoogle('/sign-in?returnTo=%2Fcheckout', { condizioniDalModulo: true, returnTo: '/' })).toBeNull();
    expect(await premiGoogle('/sign-in?returnTo=%2Fcheckout', { condizioniDalModulo: true, returnTo: '/orders' })).toBe('/orders');
  });
});
