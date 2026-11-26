// @ts-nocheck — prove portate dal sito venditore (26/11/2026): i dati finti non portano i tipi.
// Il link di Google Maps: le forme vere che arrivano dal telefono e dal computer.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { leggiIndirizzoGoogle, risolviLink, separaNomeIndirizzo, cittaDa } from '@/lib/agenti/link';

test('link lungo del computer: nome dal percorso, punto dallo spillo (non dal centro della mappa)', () => {
  const r = leggiIndirizzoGoogle('https://www.google.com/maps/place/La+Dolce+Dispensa/@45.0470,9.6900,17z/data=!3m1!4b1!4m6!3m5!1s0x4780c3f1a2b3c4d5:0x1234abcd5678ef90!8m2!3d45.0478123!4d9.6937456!16s%2Fg%2F11abc?entry=ttu');
  assert.equal(r.nome, 'La Dolce Dispensa');
  assert.equal(r.lat, 45.0478123);
  assert.equal(r.lon, 9.6937456);
  assert.equal(r.idLuogo, '0x4780c3f1a2b3c4d5:0x1234abcd5678ef90');
});

test('link condiviso dal telefono: «Nome, via, CAP città» in q= diventa nome e indirizzo', () => {
  const r = leggiIndirizzoGoogle('https://www.google.com/maps?q=Ora+del+Gusto,+Via+Roma,+12,+29121+Piacenza+PC,+Italia&ftid=0x4780c3:0x99&entry=gps&shorturl=1');
  assert.equal(r.nome, 'Ora del Gusto');
  assert.equal(r.indirizzo, 'Via Roma, 12, 29121 Piacenza PC');
  assert.equal(r.idLuogo, '0x4780c3:0x99');
  assert.equal(cittaDa(r.indirizzo), 'Piacenza');
});

test('la pagina del consenso europeo: si legge l’indirizzo dentro «continue»', () => {
  const vero = 'https://www.google.com/maps/place/Bar+Italia/@45.05,9.69,17z';
  const r = leggiIndirizzoGoogle(`https://consent.google.com/ml?continue=${encodeURIComponent(vero)}&gl=IT`);
  assert.equal(r.nome, 'Bar Italia');
  assert.equal(r.lat, 45.05);
});

test('un nome con la virgola ma senza indirizzo resta tutto nome; le coordinate sole non sono un nome', () => {
  assert.deepEqual(separaNomeIndirizzo('Pane, Amore e Fantasia'), { nome: 'Pane, Amore e Fantasia', indirizzo: null });
  assert.deepEqual(separaNomeIndirizzo('45.05, 9.69'), { nome: null, indirizzo: null });
});

const finto = (catena) => async (url) => {
  const passo = catena[url];
  if (!passo) throw new Error(`richiesta inattesa a ${url}`);
  return new Response(null, { status: passo.status, headers: passo.location ? { location: passo.location } : {} });
};

test('link corto: si seguono i rinvii leggendo solo «Location», la pagina di Google non si apre', async () => {
  const chiamate = [];
  const catena = { 'https://maps.app.goo.gl/AbC123': { status: 302, location: 'https://www.google.com/maps/place/Groppi/@45.04,9.70,17z/data=!3d45.0411!4d9.7022' } };
  const r = await risolviLink('Guarda qui https://maps.app.goo.gl/AbC123', { fetchFn: async (u, i) => { chiamate.push(u); return finto(catena)(u, i); } });
  assert.equal(r.nome, 'Groppi');
  assert.equal(r.lat, 45.0411);
  assert.deepEqual(chiamate, ['https://maps.app.goo.gl/AbC123']);
});

test('un rinvio che esce da Google si ferma (niente richieste verso indirizzi altrui)', async () => {
  const catena = { 'https://maps.app.goo.gl/Esce': { status: 302, location: 'https://sito-strano.example.net/x' } };
  const r = await risolviLink('https://maps.app.goo.gl/Esce', { fetchFn: finto(catena) });
  assert.ok(r.errore);
  assert.equal(r.nome, null);
});

test('un link che non è di Google viene rifiutato senza aprirlo', async () => {
  const r = await risolviLink('https://www.facebook.com/qualcosa', { fetchFn: async () => { throw new Error('non dovevo partire'); } });
  assert.match(r.errore, /non è di Google Maps/);
});

test('senza link: il nome scritto a mano va bene', async () => {
  const r = await risolviLink('Pasticceria Groppi, Via Trieste 3, 29122 Piacenza', { fetchFn: async () => { throw new Error('nessuna rete'); } });
  assert.equal(r.nome, 'Pasticceria Groppi');
  assert.equal(r.indirizzo, 'Via Trieste 3, 29122 Piacenza');
});
