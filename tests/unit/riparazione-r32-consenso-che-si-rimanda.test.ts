/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R32-015 — NESSUN CONSENSO FINIVA A VERBALE: LE SCELTE SUI COOKIE RESTAVANO SOLO NEL BROWSER, E
 * NESSUNO RIPROVAVA A REGISTRARLE.
 *
 * Il browser mandava la scelta a /api/consent una volta sola e non guardava la risposta. Se il
 * registro non rispondeva — rete caduta, database fermo, o la chiave di servizio che manca e fa
 * lanciare `getAdminSupabase` (la rotta cadeva con un errore non gestito) — la scelta restava
 * nel browser e basta: nessuna riga, e nessun nuovo tentativo, nemmeno dopo la riparazione.
 *
 * La prova carica `lib/consent` come lo carica una pagina (un modulo nuovo per ogni pagina) con
 * l'archivio del browser vero di jsdom, e guarda le chiamate al registro.
 */

type Chiamata = { url: string; corpo: Record<string, unknown> };
const chiamate: Chiamata[] = [];
let risposta: () => Promise<Response> = async () => new Response('{}', { status: 200 });

/** Una pagina nuova: il modulo riparte da zero, l'archivio del browser resta. */
async function pagina() {
  vi.resetModules();
  return import('@/lib/consent');
}

/** Lascia finire le promesse della registrazione. */
const lascia = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  chiamate.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    chiamate.push({ url, corpo: JSON.parse(String(init?.body ?? '{}')) });
    return risposta();
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  risposta = async () => new Response('{}', { status: 200 });
});

describe('R32-015 · la scelta sui cookie arriva al registro anche se la prima volta non ci arriva', () => {
  it('IL CASO CHE ROMPEVA — il registro risponde 503: alla pagina dopo il browser rimanda la stessa scelta', async () => {
    risposta = async () => new Response('{}', { status: 503 });
    const prima = await pagina();
    prima.writeConsent({ functional: false, analytics: true, marketing: false });
    await lascia();
    expect(chiamate).toHaveLength(1);

    // Il registro torna a posto; la persona apre un'altra pagina (il banner legge la scelta).
    risposta = async () => new Response('{}', { status: 200 });
    const seconda = await pagina();
    expect(seconda.readConsent()?.analytics).toBe(true);
    await lascia();
    expect(chiamate, 'la scelta rimasta nel browser non è stata rimandata al registro').toHaveLength(2);
    expect(chiamate[1].url).toBe('/api/consent');
    expect(chiamate[1].corpo).toMatchObject({ functional: false, analytics: true, marketing: false, versione: String(seconda.CONSENT_VERSION) });

    // Registrata: alle pagine dopo non si rimanda più.
    const terza = await pagina();
    terza.readConsent();
    terza.hasConsent('analytics');
    await lascia();
    expect(chiamate).toHaveLength(2);
  });

  it('IL CASO CHE ROMPEVA — la rete cade: anche così la scelta resta da rimandare, e si rimanda una volta per pagina', async () => {
    risposta = async () => { throw new TypeError('Failed to fetch'); };
    const prima = await pagina();
    prima.rejectAll();
    await lascia();

    const seconda = await pagina();
    seconda.readConsent();
    seconda.readConsent();
    seconda.hasConsent('analytics');
    await lascia();
    expect(chiamate, 'una pagina deve rimandare la scelta una volta sola, non a ogni lettura').toHaveLength(2);
    expect(chiamate[1].corpo).toMatchObject({ functional: false, analytics: false, marketing: false });
  });

  it('una scelta registrata al primo colpo non si rimanda', async () => {
    const prima = await pagina();
    prima.acceptAll();
    await lascia();
    const seconda = await pagina();
    seconda.readConsent();
    await lascia();
    expect(chiamate).toHaveLength(1);
  });

  it('una scelta nuova prende il posto di quella in attesa: si registra la nuova, non la vecchia', async () => {
    risposta = async () => new Response('{}', { status: 503 });
    const prima = await pagina();
    prima.acceptAll();
    await lascia();
    risposta = async () => new Response('{}', { status: 200 });
    const seconda = await pagina();
    // La persona cambia idea prima che la pagina rilegga la scelta.
    seconda.rejectAll();
    await lascia();
    const terza = await pagina();
    terza.readConsent();
    await lascia();
    expect(chiamate.map((c) => c.corpo.analytics)).toEqual([true, false]);
  });
});
