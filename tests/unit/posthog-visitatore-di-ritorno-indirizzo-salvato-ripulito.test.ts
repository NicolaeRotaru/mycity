/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 1/11/2026 — IL VISITATORE DI RITORNO NON RIMANDA L'INDIRIZZO SALVATO PRIMA.
 *
 * PostHog salva l'indirizzo d'ingresso UNA volta sola (`register_once` di
 * `$initial_person_info`) e lo rimanda a ogni `POST /flags/?v=2` tramite
 * `get_initial_props()`. La maschera in `init` vale solo per chi arriva dopo:
 * chi aveva gia' consentito ha in memoria l'indirizzo intero. Qui si usa
 * posthog-js VERO con quel valore gia' salvato.
 */

vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  POSTHOG_ACCESO: true,
}));
vi.mock('@/lib/consent', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  readConsent: () => ({ analytics: true, marketing: false }),
}));

const CHIAVE = 'ph_phc_finta_posthog';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_finta');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  localStorage.setItem(
    CHIAVE,
    JSON.stringify({
      distinct_id: 'visitatore-di-ritorno',
      $device_id: 'visitatore-di-ritorno',
      $initial_person_info: {
        r: '$direct',
        u: 'http://localhost:3000/search?q=mario.rossi%40gmail.com&utm_source=whatsapp#access_token=segreto',
      },
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("visitatore di ritorno con l'indirizzo d'ingresso gia' salvato", () => {
  it("dopo l'avvio la porta dei flag non riceve piu' la ricerca intera", async () => {
    const { track } = await import('@/lib/analytics/posthog');
    await track('prova', {});
    const { default: posthog } = await import('posthog-js');
    const iniziali = (
      posthog as unknown as { persistence: { get_initial_props: () => Record<string, unknown> } }
    ).persistence.get_initial_props();
    const url = String(iniziali.$initial_current_url);
    expect(url).toContain('/search');
    expect(decodeURIComponent(url)).not.toContain('mario.rossi');
    expect(url).not.toContain('access_token');
    // le etichette di campagna restano leggibili per l'attribuzione
    expect(url).toContain('utm_source=whatsapp');
    // e non resta nemmeno nella memoria del browser
    expect(decodeURIComponent(localStorage.getItem(CHIAVE) ?? '')).not.toContain('mario.rossi');
  });

  // 5/11/2026 (S04, scheda 2643) — La prova guardava la memoria del browser, non quello che parte
  // davvero: se la libreria spedisse alla porta dei flag un valore diverso da quello in memoria,
  // restava verde. Qui si ascolta la porta d'uscita della libreria (`_send_request`, da cui passano
  // capture e flags) e si legge ogni richiesta che parte.
  it('nessuna richiesta che parte verso PostHog porta la ricerca intera o il gettone', async () => {
    const { default: posthog } = await import('posthog-js');
    const uscite: Array<{ url: string; dati: string }> = [];
    const prototipo = Object.getPrototypeOf(posthog) as { _send_request: (o: { url: string; data?: unknown }) => unknown };
    const vera = prototipo._send_request;
    prototipo._send_request = function (this: unknown, o: { url: string; data?: unknown }) {
      uscite.push({ url: String(o.url), dati: JSON.stringify(o.data ?? null) });
      return vera.call(this, o);
    };
    try {
      const { track } = await import('@/lib/analytics/posthog');
      await track('prova', {});
      (posthog as unknown as { reloadFeatureFlags?: () => void }).reloadFeatureFlags?.();
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      prototipo._send_request = vera;
    }
    expect(uscite.some((u) => u.url.includes('/flags')), 'la porta dei flag non è stata chiamata: la prova non misurerebbe niente ' + JSON.stringify(uscite.map((u) => u.url))).toBe(true);
    for (const u of uscite) {
      const tutto = decodeURIComponent(`${u.url} ${u.dati}`);
      expect(tutto, u.url).not.toContain('mario.rossi');
      expect(tutto, u.url).not.toContain('access_token');
    }
  });
});
