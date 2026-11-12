import { describe, it, expect } from 'vitest';
import { opzioniSentry } from '@/lib/analytics/sentry-config';

/**
 * S10 (5/11/2026, scheda 102) — nel browser anche le misure di velocità
 * passano dalla pulizia dei dati personali, e senza consenso non partono.
 */
describe('le misure verso Sentry sono ripulite (102)', () => {
  it('beforeSendTransaction toglie la ricerca dall\'indirizzo e i dati dell\'utente', () => {
    const o = opzioniSentry() as unknown as { beforeSendTransaction: (e: unknown) => Record<string, any> };
    const e = o.beforeSendTransaction({
      request: { url: 'https://mycity.test/search?q=mario.rossi%40gmail.com', headers: { cookie: 'x' } },
      user: { id: 'u-1', email: 'mario@x.it', ip_address: '1.2.3.4' },
    });
    expect(JSON.stringify(e)).not.toMatch(/mario\.rossi|gmail|cookie|mario@x\.it|1\.2\.3\.4/);
    expect(e.user.id).toBe('u-1');
  });
  it('anche gli span delle chiamate di rete perdono la ricerca', () => {
    const o = opzioniSentry() as unknown as { beforeSendTransaction: (e: unknown) => Record<string, any> };
    const e = o.beforeSendTransaction({
      spans: [{ description: 'GET https://x.supabase.co/rest/v1/products?name=ilike.*mario.rossi@gmail.com*', data: { url: 'https://x.supabase.co/rest/v1/products?name=ilike.*mario*', 'http.query': 'name=ilike.*mario*' } }],
    });
    expect(JSON.stringify(e)).not.toMatch(/mario/);
    expect(e.spans[0].description).toMatch(/^GET /);
  });
  it('senza consenso (fuori dal browser) niente misure di velocità', () => {
    // R08-023 (12/11/2026): la quota non è più un numero fisso ma una funzione chiesta a ogni misura.
    expect((opzioniSentry() as unknown as { tracesSampler: () => number }).tracesSampler()).toBe(0);
  });
});
