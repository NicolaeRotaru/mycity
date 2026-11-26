// @ts-nocheck — prove portate dal sito venditore (26/11/2026): i dati finti non portano i tipi.
// La risposta dell'AD passa sempre dai paletti: queste prove diventano rosse se un paletto si allenta.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { pulisci, unisci, primaScheda, NESSUNA_PERCENTUALE } from '@/lib/agenti/scheda';

const letto = { nome: 'Bar Prova', indirizzo: 'Via Roma 1, 29121 Piacenza', lat: 45.05, lon: 9.69, idLuogo: null, link: 'https://www.google.com/maps/place/Bar+Prova/@45.05,9.69,17z' };
const osm = { lat: 45.05, lon: 9.69, indirizzo: null, luogo: { nome: 'Bar Prova', tipo: 'Bar e caffetteria', chiave: 'amenity=cafe', distanza: 5, fonte: 'https://www.openstreetmap.org/node/1', indirizzo: null, telefono: '0523 000000', sito: null, orari: 'Mo-Sa 07:00-20:00', instagram: null, facebook: null },
  concorrenti: [{ nome: 'Caffè Vicino', tipo: 'Bar', distanza: 80, fonte: 'https://www.openstreetmap.org/node/2' }], concorrentiContati: 7, raggio: 450, avvisi: [] };
const prima = () => primaScheda({ letto, osm, misura: null, citta: 'Piacenza', data: '2026-11-26 18:00' });

test('la prima scheda ha già le obiezioni fisse giuste (il 10% resta) e la scheda Google col link del venditore', () => {
  const p = prima();
  const perc = p.obiezioni.find((o) => /percentuale/.test(o.obiezione));
  assert.match(perc.risposta, /10%/);
  assert.ok(!NESSUNA_PERCENTUALE.test(perc.risposta));
  const g = p.social.find((s) => s.canale === 'Scheda Google Maps');
  assert.equal(g.fonte, letto.link);
  assert.equal(p.completa, false);
  assert.ok(p.campi.every((c) => c.stato === 'non_trovato' || /^https:\/\//.test(c.fonte)), 'ogni dato della prima scheda ha una fonte https');
});

test('«nessuna percentuale» non arriva mai al venditore, in nessuna sezione', () => {
  const r = pulisci({ in_30_secondi: ['Con noi nessuna percentuale sulle vendite.', 'Bar storico.'], gancio: 'Vi portiamo clienti senza percentuali.',
    obiezioni: [{ obiezione: 'Prendete una percentuale?', risposta: 'No, nessuna commissione.' }], consigliato: 'base' });
  assert.deepEqual(r.in_30_secondi, ['Bar storico.']);
  assert.equal(r.gancio, null);
  assert.equal(r.obiezioni.length, 0);
  assert.ok(r.scartati.length >= 3);
});

test('gioco e tabacco non entrano nelle offerte né nel potenziale', () => {
  const r = pulisci({ offerta: [{ servizio: 'Post sul Superenalotto', perche: 'Il jackpot attira.' }, { servizio: 'Social con video', perche: 'Il caffè si vende guardandolo.' }],
    potenziale: ['Promuovere le sigarette elettroniche.', 'Colazioni del sabato.'] });
  assert.deepEqual(r.offerta.map((o) => o.servizio), ['Social con video']);
  assert.deepEqual(r.potenziale, ['Colazioni del sabato.']);
});

test('un dato senza fonte https si scarta; «non_trovato» resta, vuoto', () => {
  const r = pulisci({ campi: [
    { voce: 'Instagram', valore: '@barprova', stato: 'da_confermare', fonte: 'http://instagram.com/barprova' },
    { voce: 'Recensioni Tripadvisor', valore: '4,5 su 5', stato: 'confermato', fonte: null },
    { voce: 'TikTok', valore: 'qualcosa', stato: 'non_trovato', fonte: 'https://x' },
    { voce: 'Anno di apertura', valore: '1998', stato: 'da_confermare', fonte: 'https://www.ilpiacenza.it/articolo' },
    { voce: 'Strano', valore: 'x', stato: 'sicurissimo', fonte: 'https://a.it' },
  ] });
  assert.deepEqual(r.campi.map((c) => c.voce), ['TikTok', 'Anno di apertura']);
  assert.equal(r.campi[0].valore, null);
  assert.equal(r.campi[0].fonte, null);
  assert.equal(r.scartati.length, 3);
});

test('abbonamento sconosciuto: non si inventa, si dice', () => {
  const r = pulisci({ consigliato: 'gold' });
  assert.equal(r.consigliato, null);
  assert.match(r.scartati.join(' '), /sconosciuto/);
});

test('l’unione: un dato del programma più sicuro non viene sovrascritto; le obiezioni fisse non coperte restano', () => {
  const p = prima();
  p.campi.push({ voce: 'Sito', valore: 'barprova.it — 5 pagine', stato: 'confermato', fonte: 'https://barprova.it/' });
  const ad = pulisci({ consigliato: 'business', campi: [{ voce: 'Sito', valore: 'barprova.it', stato: 'da_confermare', fonte: 'https://www.paginegialle.it/bar' }],
    obiezioni: [{ obiezione: 'Costa troppo per un bar.', risposta: 'Il primo mese costa la metà.' }],
    social: [{ canale: 'Instagram', stato: 'trovato', livello: 'debole', post_al_mese: 3, video: false, giudizio: 'Pubblica poco.', fonte: 'https://www.instagram.com/barprova/' }] });
  const s = unisci(p, ad);
  assert.equal(s.campi.find((c) => c.voce === 'Sito').stato, 'confermato');
  assert.equal(s.obiezioni[0].obiezione, 'Costa troppo per un bar.');
  assert.ok(s.obiezioni.some((o) => /percentuale/.test(o.obiezione)), 'la percentuale resta fra le obiezioni');
  assert.ok(!s.obiezioni.some((o) => o.obiezione === 'Costa troppo.'), 'il prezzo non si ripete');
  assert.equal(s.social.at(-1).canale, 'Scheda Google Maps');
  assert.match(s.social.find((x) => x.canale === 'Instagram').giudizio, /3 post al mese, senza video/);
  assert.equal(s.consigliato, 'business');
  assert.equal(s.completa, true);
  assert.ok(s.fonti.some((f) => f.url === 'https://www.instagram.com/barprova/'));
});

test('sito non guardato da nessuno: per la tabella firmata vale «medio»', () => {
  const s = unisci(prima(), pulisci({ consigliato: 'base' }));
  assert.equal(s.sito.livello, 'medio');
});

test('la prova del 26/11: se il programma ha aperto il sito e visto i profili, l’AD non può dire che mancano', () => {
  const misura = { url: 'https://www.ladolcedispensa.it/', aperto: true, https: true, titolo: 'La Dolce Dispensa', descrizione: null, telefonino: true, pagine: 5,
    funzioni: [], social: { instagram: 'https://www.instagram.com/ladolcedispensa/' }, piattaforma: 'WordPress', anno: 2025, stima: 'medio', errore: null };
  const p = primaScheda({ letto, osm: null, misura, citta: 'Piacenza', data: '2026-11-26 18:00' });
  assert.equal(p.social.find((x) => x.canale === 'Instagram').fonte, 'https://www.instagram.com/ladolcedispensa/');
  const ad = pulisci({ consigliato: 'base', sito: { livello: 'nessuno', giudizio: 'Nessun sito trovato.', fonte: null },
    non_ha: ['Un sito trovato in rete', 'Profili Instagram, Facebook o TikTok trovati', 'La prenotazione in rete'],
    social: [{ canale: 'Instagram', stato: 'non_trovato', fonte: null }] });
  const s = unisci(p, ad);
  assert.equal(s.sito.livello, 'medio');
  assert.equal(s.sito.daChi, 'programma');
  assert.equal(s.sito.giudizio, null);
  assert.deepEqual(s.non_ha, ['La prenotazione in rete']);
  assert.equal(s.social.find((x) => x.canale === 'Instagram').stato, 'trovato');
  assert.ok(s.avvisi.some((a) => /non aveva visto il sito/.test(a)));
});

import { readFileSync } from 'node:fs';
test('la risposta vera dell’AD del 26/11 (La Dolce Dispensa, 37 secondi) passa i controlli senza perdere niente di buono', () => {
  const vera = JSON.parse(readFileSync(new URL('./dolce-dispensa-ad.json', import.meta.url), 'utf8'));
  const ad = pulisci(vera);
  assert.deepEqual(ad.scartati, []);
  assert.equal(ad.campi.length, 8);
  const s = unisci(prima(), ad, ['Nessuna pagina è stata aperta.']);
  assert.equal(s.consigliato, 'base');
  assert.equal(s.in_30_secondi.length, 4);
  assert.ok(s.gancio);
  assert.equal(s.obiezioni.length, 2 + 2, 'le due dell’AD più percentuale e prezzo (il tempo l’AD l’ha già coperto)');
  assert.ok(s.social.filter((x) => x.canale !== 'Scheda Google Maps').every((x) => x.stato === 'non_trovato'));
  assert.ok(s.fonti.some((f) => f.url.includes('matrimonio.com')));
});
