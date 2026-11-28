// @ts-nocheck — prove portate dal sito venditore (26/11/2026): i dati finti non portano i tipi.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { misuraHtml, NON_E_UN_SITO } from '@/lib/agenti/sito';
import { leggiOverpass, somiglianza } from '@/lib/agenti/osm';
import { indirizzoSicuro } from '@/lib/agenti/rete';

const html = `<!doctype html><html lang="it"><head><title>Pasticceria Rossi | Torte a Piacenza</title>
<meta name="viewport" content="width=device-width"><meta name="description" content="Torte su misura dal 1980">
<meta name="generator" content="WordPress 6.6"></head><body>
<a href="/chi-siamo">Chi siamo</a><a href="/torte/">Torte</a><a href="https://www.rossi.it/contatti">Contatti</a><a href="/logo.png">x</a>
<a href="https://www.instagram.com/pasticceriarossi/">IG</a><a href="https://www.facebook.com/sharer/sharer.php?u=x">condividi</a>
<a href="https://www.facebook.com/PasticceriaRossi">FB</a><a href="https://wa.me/39333">WhatsApp</a><a href="/prenota">Prenota la torta</a>
<footer>© 2019 Pasticceria Rossi</footer></body></html>`;

test('misura del sito: pagine interne, profili collegati, funzioni, piattaforma e anno', () => {
  const m = misuraHtml(html, 'https://www.rossi.it/');
  assert.equal(m.titolo, 'Pasticceria Rossi | Torte a Piacenza');
  assert.equal(m.descrizione, 'Torte su misura dal 1980');
  assert.equal(m.telefonino, true);
  assert.equal(m.pagine, 4); // chi-siamo, torte, contatti, prenota (non il logo)
  assert.equal(m.social.instagram, 'https://www.instagram.com/pasticceriarossi/');
  assert.equal(m.social.facebook, 'https://www.facebook.com/PasticceriaRossi'); // non il pulsante «condividi»
  assert.ok(m.funzioni.includes('prenotazioni') && m.funzioni.includes('WhatsApp'));
  assert.equal(m.piattaforma, 'WordPress');
  assert.equal(m.anno, 2019);
  assert.equal(m.stima, 'semplice'); // anno vecchio di più di tre anni = datato
});

test('un profilo social o un elenco non è «il sito»', () => {
  assert.ok(NON_E_UN_SITO.test('www.facebook.com'));
  assert.ok(NON_E_UN_SITO.test('www.tripadvisor.it'));
  assert.ok(!NON_E_UN_SITO.test('www.ladolcedispensa.it'));
});

test('rete: niente indirizzi interni, IP, porte strane o credenziali', () => {
  for (const x of ['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'https://[::1]/', 'http://intranet/', 'https://a.it:8443/', 'https://user:pw@a.it/', 'file:///etc/passwd', 'http://metadata.internal/'])
    assert.equal(indirizzoSicuro(x), null, x);
  assert.ok(indirizzoSicuro('www.ladolcedispensa.it'));
});

test('mappa libera: trova il negozio per nome vicino al punto e conta i concorrenti della stessa famiglia', () => {
  const el = [
    { type: 'node', id: 1, lat: 45.0478, lon: 9.6937, tags: { name: 'La Dolce Dispensa', shop: 'pastry', website: 'https://www.ladolcedispensa.it', phone: '+39 331 0000000', 'contact:instagram': 'ladolcedispensa' } },
    { type: 'node', id: 2, lat: 45.0490, lon: 9.6950, tags: { name: 'Pasticceria Gobbi', shop: 'pastry' } },
    { type: 'way', id: 3, center: { lat: 45.0500, lon: 9.6960 }, tags: { name: 'Forno Bianchi', shop: 'bakery' } },
    { type: 'node', id: 4, lat: 45.0479, lon: 9.6938, tags: { name: 'Farmacia Centrale', amenity: 'pharmacy' } },
    { type: 'node', id: 5, lat: 45.0600, lon: 9.7100, tags: { name: 'Pasticceria Lontana', shop: 'pastry' } },
  ];
  const r = leggiOverpass(el, 45.0478, 9.6937, 'La dolce dispensa', 450);
  assert.equal(r.luogo.nome, 'La Dolce Dispensa');
  assert.equal(r.luogo.tipo, 'Pasticceria');
  assert.equal(r.luogo.instagram, 'https://www.instagram.com/ladolcedispensa');
  assert.equal(r.luogo.fonte, 'https://www.openstreetmap.org/node/1');
  assert.deepEqual(r.concorrenti.map((c) => c.nome), ['Pasticceria Gobbi', 'Forno Bianchi']); // non la farmacia, non quella a 2 km
  assert.equal(r.concorrentiContati, 2);
});

test('mappa libera: un nome diverso non viene scambiato per il negozio', () => {
  const el = [{ type: 'node', id: 9, lat: 45.0478, lon: 9.6937, tags: { name: 'Bar Sport', amenity: 'cafe' } }];
  assert.equal(leggiOverpass(el, 45.0478, 9.6937, 'Caffè Roma', 450).luogo, null);
  assert.ok(somiglianza('Bar Caffè Roma', 'Caffè Roma') >= 0.9);
});

import { candidatiDominio, eIlSitoDi } from '@/lib/agenti/sito';

test('gli indirizzi da provare: col nome intero, senza articolo, senza la parola generica, con la città', () => {
  const c = candidatiDominio('La Dolce Dispensa', 'Piacenza');
  assert.equal(c[0], 'ladolcedispensa.it');
  assert.ok(c.includes('dolcedispensa.it'));
  assert.ok(c.length <= 12); // 28/11/2026: da 8 a 12, coi nomi senza parole comuni, invertiti e dai profili
  assert.ok(candidatiDominio('Pasticceria Groppi', 'Piacenza').includes('groppi.it'));
  assert.ok(candidatiDominio("Caffè dell'Arte", 'Piacenza').includes('caffedellarte.it'));
  assert.deepEqual(candidatiDominio('!!', 'Piacenza'), []);
});

test('si tiene un sito solo se porta il nome e la città, e non è una pagina di parcheggio', () => {
  const vera = '<title>La Dolce Dispensa | pasticceria a Piacenza per torte indimenticabili</title><body>Via Bianchi 27</body>';
  assert.equal(eIlSitoDi(vera, 'La Dolce Dispensa', 'Piacenza'), true);
  assert.equal(eIlSitoDi('<title>La Dolce Dispensa</title><body>Torino</body>', 'La Dolce Dispensa', 'Piacenza'), false, 'omonimo di un’altra città');
  assert.equal(eIlSitoDi('<title>Bar Roma Piacenza</title>', 'La Dolce Dispensa', 'Piacenza'), false);
  assert.equal(eIlSitoDi('<title>ladolcedispensa.it - dominio in vendita</title> Piacenza', 'La Dolce Dispensa', 'Piacenza'), false);
});
