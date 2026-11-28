// @ts-nocheck
// Prove del collaudo indipendente del 28/11/2026 sulla scheda del venditore (sito e social): chi le ha scritte non ha costruito.
// leggiPagina VERO, con http/https/dns finti: si prova la catena dei rinvii come gira davvero.
import { vi, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
const rete = vi.hoisted(() => ({ risposte: {} as Record<string, { stato: number; dove?: string; html?: string }>, chieste: [] as string[] }));
const finta = (u: URL, _o: unknown, cb: (r: unknown) => void) => {
  const req = new EventEmitter() as any;
  req.end = () => {
    const k = u.toString();
    rete.chieste.push(k);
    const r = rete.risposte[k];
    if (!r) { setImmediate(() => req.emit('error', Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))); return; }
    const res = new EventEmitter() as any;
    res.statusCode = r.stato; res.headers = { 'content-type': 'text/html', ...(r.dove ? { location: r.dove } : {}) };
    res.resume = () => {}; res.destroy = () => {};
    setImmediate(() => { cb(res); setImmediate(() => { if (r.html) res.emit('data', Buffer.from(r.html)); res.emit('end'); }); });
  };
  return req;
};
vi.mock('node:https', () => ({ request: finta, default: { request: finta } }));
vi.mock('node:http', () => ({ request: finta, default: { request: finta } }));
const { leggiPagina } = await import('@/lib/agenti/rete');
const { sitoIndicato, misuraSito, indovinaSito } = await import('@/lib/agenti/sito');
beforeEach(() => { rete.risposte = {}; rete.chieste = []; });
const fb = '<html><head><title>Raquel Cafè | Piacenza | Facebook</title></head><body><h1>Raquel Cafè</h1>Piazza Duomo 23, Piacenza</body></html>';

it('G2a catena di due rinvii http->https->facebook: Meta mai chiesta, niente sito', async () => {
  rete.risposte['http://raquelcafe.it/'] = { stato: 301, dove: 'https://raquelcafe.it/' };
  rete.risposte['https://raquelcafe.it/'] = { stato: 301, dove: 'https://www.facebook.com/raquelcafe23' };
  rete.risposte['https://www.facebook.com/raquelcafe23'] = { stato: 200, html: fb };
  const p = await leggiPagina('http://raquelcafe.it/');
  console.log('G2a', p.ok, p.url, p.errore, rete.chieste);
  expect(rete.chieste.some((u) => u.includes('facebook'))).toBe(false);
  expect(p.ok).toBe(false);
  expect(await sitoIndicato('raquelcafe.it', 'Raquel 💗 Cafè', 'Piacenza', { fidato: true })).toBeNull();
  expect((await misuraSito('raquelcafe.it')).aperto).toBe(false);
});
it('G2b accorciatore -> instagram (due rinvii), e rinvio a m.facebook / fb.me / l.instagram', async () => {
  for (const meta of ['https://www.instagram.com/raquel/', 'https://m.facebook.com/raquel', 'https://fb.me/raquel', 'https://l.instagram.com/?u=x', 'HTTPS://WWW.FACEBOOK.COM./raquel']) {
    rete.risposte = {}; rete.chieste = [];
    rete.risposte['https://raquelcafe.it/'] = { stato: 302, dove: 'https://bit.ly/abc' };
    rete.risposte['https://bit.ly/abc'] = { stato: 301, dove: meta };
    rete.risposte[new URL(meta).toString()] = { stato: 200, html: fb };
    const p = await leggiPagina('https://raquelcafe.it/');
    console.log('G2b', meta, '->', p.ok, p.errore, rete.chieste.length);
    expect(p.ok).toBe(false);
    expect(await sitoIndicato('raquelcafe.it', 'Raquel 💗 Cafè', 'Piacenza', { fidato: true })).toBeNull();
  }
});
it('G2c rinvio a un elenco non Meta (linktr.ee, tripadvisor, paginegialle): letto ma mai «il sito»', async () => {
  for (const el of ['https://linktr.ee/raquelcafe', 'https://www.paginegialle.it/raquel', 'https://www.youtube.com/@raquel']) {
    rete.risposte = {};
    rete.risposte['https://raquelcafe.it/'] = { stato: 301, dove: el };
    rete.risposte[el] = { stato: 200, html: fb };
    expect(await sitoIndicato('raquelcafe.it', 'Raquel 💗 Cafè', 'Piacenza', { fidato: true })).toBeNull();
    expect((await misuraSito('raquelcafe.it')).aperto).toBe(false);
    expect(await indovinaSito('Raquel 💗 Cafè', 'Piacenza', 1000, [], 'Piazza Duomo, 23, 29121 Piacenza PC')).toBeNull();
  }
});
it('G2d controllo: un sito vero con rinvio http->https->www resta buono', async () => {
  rete.risposte['https://raquelcafe.it/'] = { stato: 301, dove: 'https://www.raquelcafe.it/' };
  rete.risposte['https://www.raquelcafe.it/'] = { stato: 200, html: '<html><head><title>Raquel Caffè</title></head><body>Piazza Duomo 23, Piacenza</body></html>' };
  expect((await sitoIndicato('raquelcafe.it', 'Raquel 💗 Cafè', 'Piacenza', { fidato: true }))?.url).toBe('https://www.raquelcafe.it/');
});
