// @ts-nocheck — prove portate dal sito venditore (26/11/2026): i dati finti non portano i tipi.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ipNonPubblico } from '@/lib/agenti/rete';
import { leggiIndirizzoGoogle, risolviLink, separaNomeIndirizzo } from '@/lib/agenti/link';
import { normalizza } from '@/lib/agenti/scheda';

test('rete: gli indirizzi interni trovati dal collaudo non si aprono; quelli pubblici sì', () => {
  for (const ip of ['64:ff9b::a9fe:a9fe', '2002:a9fe:a9fe::1', '::a9fe:a9fe', '::127.0.0.1', 'fec0::1', 'fe90::1', 'ff02::1', '198.18.0.1',
    '127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1', '100.64.0.1', '0.0.0.0'])
    assert.equal(ipNonPubblico(ip), true, ip);
  for (const ip of ['8.8.8.8', '151.101.1.69', '2a00:1450:4002:400::200e', '::ffff:8.8.8.8'])
    assert.equal(ipNonPubblico(ip), false, ip);
});

test('link: spillo lasciato cadere, coordinate in gradi, città dentro il nome, HTTPS maiuscolo', async () => {
  const s = leggiIndirizzoGoogle('https://www.google.com/maps/search/45.0526,+9.6930?entry=tts');
  assert.deepEqual([s.nome, s.lat, s.lon], [null, 45.0526, 9.693]);
  const g = leggiIndirizzoGoogle("https://www.google.com/maps/place/45%C2%B003'09.0%22N+9%C2%B041'29.0%22E/@45.05,9.69,17z");
  assert.equal(g.nome, null); assert.equal(g.lat, 45.0525);
  assert.equal(leggiIndirizzoGoogle('https://www.google.com/search?q=La+Dolce+Dispensa+Piacenza').nome, 'La Dolce Dispensa');
  assert.deepEqual(separaNomeIndirizzo('Bar Roma, Piacenza'), { nome: 'Bar Roma', indirizzo: 'Piacenza' });
  assert.deepEqual(separaNomeIndirizzo('Bar Roma Piacenza'), { nome: 'Bar Roma', indirizzo: 'Piacenza' });
  const u = await risolviLink('HTTPS://WWW.GOOGLE.COM/maps/place/Groppi/@45.04,9.70,17z', { fetchFn: async () => { throw new Error('non serve'); } });
  assert.equal(u.nome, 'Groppi');
});

test('una prima scheda vecchia o storta non fa saltare la pagina', () => {
  const s = normalizza({ nome: 'Bar Vecchio', campi: [{ voce: 'Nome', valore: 'Bar Vecchio', stato: 'da_confermare', fonte: null }, { voce: 1 }] });
  assert.equal(s.nome, 'Bar Vecchio');
  assert.deepEqual(s.concorrenti, []);
  assert.equal(s.sito.livello, 'non visto');
  assert.equal(s.campi.length, 1);
  assert.equal(normalizza({ campi: [] }), null);
  assert.equal(normalizza('scheda'), null);
});
