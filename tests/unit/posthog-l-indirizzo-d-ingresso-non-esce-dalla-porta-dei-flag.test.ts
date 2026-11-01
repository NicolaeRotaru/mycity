/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 1/11/2026 — L'INDIRIZZO D'INGRESSO NON ESCE INTERO DALLA PORTA DEI FLAG.
 *
 * La richiesta `POST /flags/?v=2` di PostHog non passa da `before_send` e porta
 * `person_properties.$initial_current_url`. PostHog la maschera solo se in `init`
 * c'e' `mask_personal_data_properties: true` e i nomi dei parametri da nascondere.
 * Qui si guardano le opzioni vere passate a `init` partendo da `/search?q=<email>`.
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
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  POSTHOG_ACCESO: true,
}));
vi.mock('@/lib/consent', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  readConsent: () => ({ analytics: true, marketing: false }),
}));

beforeEach(() => {
  vi.resetModules();
  posthog.init.mockClear();
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_finta');
});
afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
});

async function opzioniDiInit(): Promise<Record<string, unknown>> {
  const { track } = await import('@/lib/analytics/posthog');
  await track('prova', {});
  expect(posthog.init).toHaveBeenCalledTimes(1);
  return posthog.init.mock.calls[0][1] as Record<string, unknown>;
}

describe("l'indirizzo d'ingresso della sessione", () => {
  it('sessione che parte da /search?q=<email>: PostHog maschera la ricerca anche fuori da before_send', async () => {
    window.history.replaceState(null, '', '/search?q=mario.rossi%40gmail.com&ordine=A-123&utm_source=whatsapp#access_token=x');
    const o = await opzioniDiInit();
    expect(o.mask_personal_data_properties).toBe(true);
    const nomi = o.custom_personal_data_properties as string[];
    expect(nomi).toEqual(expect.arrayContaining(['q', 'ordine']));
    // le etichette di campagna restano leggibili per l'attribuzione
    expect(nomi).not.toContain('utm_source');
    expect(o.disable_capture_url_hashes).toBe(true);
    // il cancello sugli eventi resta al suo posto
    expect(typeof o.before_send).toBe('function');
  });

  it('anche su un indirizzo senza parametri i nomi tipici sono gia\' coperti', async () => {
    const o = await opzioniDiInit();
    expect(o.mask_personal_data_properties).toBe(true);
    expect(o.custom_personal_data_properties).toEqual(expect.arrayContaining(['q', 'email', 'token']));
  });
});
