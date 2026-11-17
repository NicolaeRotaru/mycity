import { describe, it, expect, vi, afterEach } from 'vitest';
import { controllaTrasformazioneFoto } from '@/lib/image-url';

/**
 * R30-009 — se la trasformazione delle foto di Supabase smette di rispondere (abbonamento scaduto:
 * ogni `/render/image/` dice 403), un controllo se ne deve accorgere. L'aiutante chiede una foto
 * vera nello stesso modo del sito e dice ok / degradato / saltato. La rete è finta.
 */

const FOTO = 'https://abcdefgh.supabase.co/storage/v1/object/public/products/negozio/foto.jpg';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function reteFinta(status: number) {
  return vi.fn(async (_indirizzo: string, _init?: RequestInit) => new Response('x', { status }));
}

describe('R30-009 — il controllo della trasformazione delle foto', () => {
  it('403 dalla trasformazione: degradato', async () => {
    const rete = reteFinta(403);
    await expect(controllaTrasformazioneFoto({ fetch: rete, timeoutMs: 2000, urlFoto: FOTO })).resolves.toBe('degradato');
    // La foto si chiede come la chiede il sito: dalla trasformazione, non dall'originale.
    expect(rete).toHaveBeenCalledTimes(1);
    expect(String(rete.mock.calls[0][0])).toContain('/storage/v1/render/image/public/products/negozio/foto.jpg');
    expect(String(rete.mock.calls[0][0])).toContain('width=100');
  });

  it('200 dalla trasformazione: ok', async () => {
    await expect(controllaTrasformazioneFoto({ fetch: reteFinta(200), timeoutMs: 2000, urlFoto: FOTO })).resolves.toBe('ok');
  });

  it('interruttore spento: saltato, e nessuna richiesta', async () => {
    vi.stubEnv('NEXT_PUBLIC_FOTO_SENZA_TRASFORMAZIONE', '1');
    const rete = reteFinta(403);
    await expect(controllaTrasformazioneFoto({ fetch: rete, timeoutMs: 2000, urlFoto: FOTO })).resolves.toBe('saltato');
    expect(rete).not.toHaveBeenCalled();
  });

  it('nessuna risposta entro il tetto: degradato, senza restare appeso', async () => {
    vi.useFakeTimers();
    const appesa = vi.fn((_indirizzo: string, _init?: RequestInit) => new Promise<Response>(() => {}));
    const esito = controllaTrasformazioneFoto({ fetch: appesa, timeoutMs: 1500, urlFoto: FOTO });
    await vi.advanceTimersByTimeAsync(1500);
    await expect(esito).resolves.toBe('degradato');
    expect((appesa.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('la rete che cade: degradato, non un errore', async () => {
    const rotta = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(controllaTrasformazioneFoto({ fetch: rotta, timeoutMs: 2000, urlFoto: FOTO })).resolves.toBe('degradato');
  });

  it('una foto che non passa dalla trasformazione: saltato', async () => {
    const rete = reteFinta(403);
    await expect(controllaTrasformazioneFoto({ fetch: rete, timeoutMs: 2000, urlFoto: 'https://images.pexels.com/photos/1/a.jpg' })).resolves.toBe('saltato');
    await expect(controllaTrasformazioneFoto({ fetch: rete, timeoutMs: 2000, urlFoto: null })).resolves.toBe('saltato');
    expect(rete).not.toHaveBeenCalled();
  });
});
