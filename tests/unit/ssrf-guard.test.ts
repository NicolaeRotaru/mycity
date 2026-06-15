import { describe, it, expect, vi, afterEach } from 'vitest';
import { assertSafePublicUrl, safeImageFetch, SsrfBlockedError, type DnsResolver } from '@/lib/net/ssrf-guard';

/**
 * Guard anti-SSRF per i fetch server-side di URL utente (rehost immagini import).
 * Garantisce che il server NON possa essere indotto a fetchare indirizzi interni
 * (loopback, reti private, link-local/metadata cloud) né direttamente né via
 * redirect. Il resolver DNS è iniettato per testare il caso "host pubblico che
 * risolve a IP privato" senza rete reale.
 */

const publicResolver: DnsResolver = async () => [{ address: '93.184.216.34', family: 4 }]; // public
const privateResolver: DnsResolver = async () => [{ address: '10.1.2.3', family: 4 }]; // interno

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assertSafePublicUrl', () => {
  it('rifiuta schemi non http(s)', async () => {
    await expect(assertSafePublicUrl('ftp://example.com/x', publicResolver)).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertSafePublicUrl('file:///etc/passwd', publicResolver)).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertSafePublicUrl('not a url', publicResolver)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rifiuta IP-literal interni (incl. metadata cloud)', async () => {
    const blocked = [
      'http://169.254.169.254/latest/meta-data/', // AWS/GCP metadata
      'http://127.0.0.1/',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://[::1]/',
      'http://[fd00::1]/', // ULA
      'http://[fe80::1]/', // link-local
    ];
    for (const u of blocked) {
      await expect(assertSafePublicUrl(u, publicResolver), u).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  it('rifiuta hostname interni', async () => {
    await expect(assertSafePublicUrl('http://localhost/', publicResolver)).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertSafePublicUrl('http://foo.internal/', publicResolver)).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertSafePublicUrl('http://db.local/', publicResolver)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rifiuta host pubblico che risolve a IP privato (anti DNS-to-internal)', async () => {
    await expect(assertSafePublicUrl('http://evil.example.com/', privateResolver)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('accetta host pubblico che risolve a IP pubblico', async () => {
    await expect(assertSafePublicUrl('https://example.com/img.jpg', publicResolver)).resolves.toBeInstanceOf(URL);
  });
});

describe('safeImageFetch', () => {
  it('blocca un redirect verso una destinazione interna', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      safeImageFetch('https://example.com/x.jpg', { timeoutMs: 1000, resolver: publicResolver }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('restituisce la risposta per un URL pubblico senza redirect', async () => {
    const fetchMock = vi.fn(async () => new Response('img', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await safeImageFetch('https://example.com/x.jpg', { timeoutMs: 1000, resolver: publicResolver });
    expect(res.status).toBe(200);
  });
});
