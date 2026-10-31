/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 31/10/2026 — POSTHOG SPENTO AL LANCIO, E I CLIC NON ESCONO DALLE PAGINE CON DATI DI TERZI.
 *
 * Sulle pagine con dati di altre persone (/seller, /rider, /admin, /orders…) si spegneva solo la
 * registrazione dello schermo. La raccolta automatica dei clic restava accesa: il negoziante che
 * tocca il telefono del cliente in un ordine mandava negli Stati Uniti un evento col testo di
 * quell'elemento, cioè il numero. Qui si guarda il cancello vero (`before_send`), e si prova che
 * con `POSTHOG_ACCESO` spento la libreria non parte nemmeno con la chiave su Vercel.
 */

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  register: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('posthog-js', () => ({ default: posthog }));
vi.mock('@/lib/consent', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  readConsent: () => ({ analytics: true, marketing: false }),
}));

const TELEFONO = '+39 333 123 4567';
function clic(pathname: string, evento = '$autocapture') {
  return {
    uuid: 'u1',
    event: evento,
    properties: { $pathname: pathname, $elements: [{ tag_name: 'a', $el_text: TELEFONO, attr__href: `tel:${TELEFONO}` }] },
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  posthog.init.mockClear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => vi.unstubAllEnvs());

describe('i clic raccolti da soli', () => {
  it.each(['/seller/orders/ord-1', '/rider/orders/ord-1', '/admin/sos', '/orders/ord-1'])(
    'su %s non partono: il telefono del cliente resta qui',
    async (pagina) => {
      const { eventoSenzaDatiPersonali } = await import('@/lib/analytics/posthog');
      expect(eventoSenzaDatiPersonali(clic(pagina))).toBeNull();
      expect(eventoSenzaDatiPersonali(clic(pagina, '$rageclick'))).toBeNull();
    },
  );

  it('anche se il clic non dice la pagina, conta quella aperta', async () => {
    window.history.replaceState(null, '', '/seller/orders/ord-1');
    const { eventoSenzaDatiPersonali } = await import('@/lib/analytics/posthog');
    const senzaPagina = { uuid: 'u2', event: '$autocapture', properties: { $elements: [{ $el_text: TELEFONO }] } } as never;
    expect(eventoSenzaDatiPersonali(senzaPagina)).toBeNull();
  });

  it('controprova: su una pagina pubblica il clic passa, e la visita di pagina non si tocca', async () => {
    const { eventoSenzaDatiPersonali } = await import('@/lib/analytics/posthog');
    expect(eventoSenzaDatiPersonali(clic('/negozi/forno'))).not.toBeNull();
    expect(eventoSenzaDatiPersonali({ uuid: 'u3', event: '$pageview', properties: { $pathname: '/seller' } } as never)).not.toBeNull();
  });
});

describe('PostHog spento al lancio', () => {
  it('con la chiave su Vercel e il consenso dato, la libreria non parte', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_finta');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com');
    const { track } = await import('@/lib/analytics/posthog');
    await track('prova_lancio', { pagina: '/' });
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });
});
