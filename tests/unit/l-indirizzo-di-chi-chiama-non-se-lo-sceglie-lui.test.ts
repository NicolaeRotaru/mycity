import { describe, it, expect, afterEach } from 'vitest';
import { getClientIp } from '@/lib/rate-limit';

/**
 * CHI BUSSA SI SCEGLIEVA IL PROPRIO INDIRIZZO, E COSI' AZZERAVA OGNI FRENO.
 *
 * Radiografia del 27/8/2026 (R018). Ogni freno anti-abuso del sito conta le
 * richieste per indirizzo di rete: accessi, registrazioni, cassa, chat. Quel
 * numero lo dava `getClientIp`, che credeva sulla parola l'intestazione
 * `cf-connecting-ip`.
 *
 * Quell'intestazione la scrive Cloudflare, ed e' affidabile SOLO se la
 * richiesta e' passata davvero di li'. Chi arriva diritto all'origine Vercel
 * — che e' raggiungibile, e non serve saperne l'indirizzo: basta il nome del
 * sito — se la scrive da solo. Cambiandola a ogni richiesta diventa un
 * visitatore nuovo ogni volta: nessun contatore arriva mai al suo tetto.
 * Diecimila tentativi di accesso al minuto contati come diecimila persone
 * diverse.
 *
 * `x-forwarded-for` invece su Vercel NON e' falsificabile: la piattaforma la
 * riscrive con l'indirizzo vero di chi chiama e butta via quello che il
 * chiamante si e' messo (sta scritto nel commento di TRUSTED_PROXY_HOPS).
 * Quindi ignorare `cf-connecting-ip` non toglie niente: ci si appoggia alla
 * fonte che la piattaforma garantisce.
 *
 * Resta la strada per chi Cloudflare ce l'ha davvero davanti: un segreto
 * condiviso di bordo. Se `EDGE_TRUST_SECRET` e' configurato e la richiesta
 * porta lo stesso valore in `x-edge-token`, allora `cf-connecting-ip` e'
 * autentica e si usa.
 */

const salvato = { ...process.env };
afterEach(() => { process.env = { ...salvato }; });

function richiesta(headers: Record<string, string>): Request {
  return new Request('https://mycity.test/api/prova', { headers });
}

describe('l indirizzo di chi chiama non se lo sceglie lui', () => {
  it('senza segreto di bordo, cf-connecting-ip viene ignorata', () => {
    delete process.env.EDGE_TRUST_SECRET;
    const ip = getClientIp(richiesta({
      'cf-connecting-ip': '1.2.3.4', // se la scrive il chiamante
      'x-forwarded-for': '203.0.113.9', // questa la scrive Vercel
    }));
    expect(
      ip,
      'chi bussa si e scelto l indirizzo: cambiandolo a ogni richiesta nessun freno scatta mai',
    ).toBe('203.0.113.9');
  });

  it('col segreto giusto, cf-connecting-ip vale: e Cloudflare che parla', () => {
    process.env.EDGE_TRUST_SECRET = 'segreto-di-bordo';
    const ip = getClientIp(richiesta({
      'cf-connecting-ip': '198.51.100.7',
      'x-edge-token': 'segreto-di-bordo',
      'x-forwarded-for': '203.0.113.9',
    }));
    expect(ip).toBe('198.51.100.7');
  });

  it('col segreto sbagliato non vale niente', () => {
    process.env.EDGE_TRUST_SECRET = 'segreto-di-bordo';
    const ip = getClientIp(richiesta({
      'cf-connecting-ip': '1.2.3.4',
      'x-edge-token': 'tentativo',
      'x-forwarded-for': '203.0.113.9',
    }));
    expect(ip).toBe('203.0.113.9');
  });

  it('col segreto configurato ma senza intestazione, cf-connecting-ip non vale', () => {
    process.env.EDGE_TRUST_SECRET = 'segreto-di-bordo';
    const ip = getClientIp(richiesta({
      'cf-connecting-ip': '1.2.3.4',
      'x-forwarded-for': '203.0.113.9',
    }));
    expect(ip).toBe('203.0.113.9');
  });

  it('due richieste con cf-connecting-ip diverse restano lo stesso visitatore', () => {
    // E' il cuore del difetto: se bastasse cambiare quell intestazione, il
    // contatore per indirizzo non arriverebbe mai al tetto.
    delete process.env.EDGE_TRUST_SECRET;
    const a = getClientIp(richiesta({ 'cf-connecting-ip': '10.0.0.1', 'x-forwarded-for': '203.0.113.9' }));
    const b = getClientIp(richiesta({ 'cf-connecting-ip': '10.0.0.2', 'x-forwarded-for': '203.0.113.9' }));
    expect(a).toBe(b);
  });

  it('senza niente da leggere non inventa un indirizzo', () => {
    expect(getClientIp(richiesta({}))).toBe('unknown');
  });

  it('x-real-ip resta il ripiego quando manca x-forwarded-for', () => {
    delete process.env.EDGE_TRUST_SECRET;
    expect(getClientIp(richiesta({ 'x-real-ip': '192.0.2.5' }))).toBe('192.0.2.5');
  });
});
