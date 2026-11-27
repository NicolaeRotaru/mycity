// @vitest-environment jsdom
// @ts-nocheck — i dati finti della scheda (come in scheda.test.ts) non portano i tipi.
//
// SU MISURA DENTRO OGNI ABBONAMENTO — Nicola, 26/11/2026: «dentro ogni abbonamento deve esserci la personalizzazione
// esatta del servizio che offriamo al cliente, sono dati che già recuperi devi solo studiare e venderli all'azienda».
// Sul codice di prima sono rosse: le tre schede avevano solo il listino, uguale per ogni negozio.
// Restano rosse se l'AD può promettere nel Base quello che il Base non dà, se il programma inventa un profilo
// mancante prima che l'AD l'abbia cercato, o se la riga dell'AD non vince su quella del programma.
import { afterEach, expect, test } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Scheda from '@/components/agenti/Scheda';
import { primaScheda, pulisci, unisci, normalizza, promessaFuoriFascia, negaIlDieciPerCento } from '@/lib/agenti/scheda';
import { rigaSuMisura, percheSuMisura } from '@/lib/agenti/su-misura';
import { COMPITO, SCHEMA } from '@/lib/agenti/compito';
import { FASCE as LISTINO, SERVIZI_AGENZIA, ABBONAMENTI } from '@/lib/agenzia/preventivo';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const letto = { nome: 'Forno Rossi', indirizzo: 'Via Roma 1, 29121 Piacenza', lat: 45.05, lon: 9.69, idLuogo: null, link: 'https://www.google.com/maps/place/Forno/@45.05,9.69,17z' };
const vicini = [
  { nome: 'Panificio Sei', tipo: 'Panetteria', distanza: 420, fonte: 'https://www.openstreetmap.org/node/6' },
  { nome: 'Panificio Uno', tipo: 'Panetteria', distanza: 60, fonte: 'https://www.openstreetmap.org/node/1' },
  { nome: 'Panificio Due', tipo: 'Panetteria', distanza: 110, fonte: 'https://www.openstreetmap.org/node/2' },
  { nome: 'Panificio Tre', tipo: 'Panetteria', distanza: 150, fonte: 'https://www.openstreetmap.org/node/3' },
  { nome: 'Panificio Quattro', tipo: 'Panetteria', distanza: 200, fonte: 'https://www.openstreetmap.org/node/4' },
  { nome: 'Panificio Cinque', tipo: 'Panetteria', distanza: 300, fonte: 'https://www.openstreetmap.org/node/5' },
];
const osm = (concorrenti = vicini) => ({ lat: 45.05, lon: 9.69, indirizzo: null,
  luogo: { nome: 'Forno Rossi', tipo: 'Panetteria', chiave: 'shop=bakery', distanza: 5, fonte: 'https://www.openstreetmap.org/node/9', indirizzo: null, telefono: null, sito: null, orari: 'Mo-Sa 07:00-13:00', instagram: null, facebook: null },
  concorrenti, concorrentiContati: concorrenti.length + 1, raggio: 450, avvisi: [] });
const misura = (x = {}) => ({ url: 'https://www.fornorossi.it/', aperto: true, https: false, titolo: 'Forno Rossi', descrizione: null, telefonino: false, pagine: 2,
  funzioni: [], social: {}, piattaforma: null, anno: 2018, stima: 'semplice', errore: null, ...x });
const prima = (m = null, o = osm()) => primaScheda({ letto, osm: o, misura: m, citta: 'Piacenza', data: '2026-11-26 18:00' });

const aperti = [];
function disegna(s) {
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  act(() => root.render(<Scheda s={s} />));
  aperti.push({ root, radice });
  return { radice, ridisegna: (n) => act(() => root.render(<Scheda s={n} />)) };
}
afterEach(() => { for (const { root, radice } of aperti.splice(0)) { act(() => root.unmount()); radice.remove(); } });
// Per tag, non per id: con due schede aperte nella stessa prova jsdom cerca l'id in tutto il documento e trova l'altra.
// 27/11: il menu non è più una tendina ma una fila di bottoni (data-pagina); la parte aperta ha aria-current.
function scegli(r, id) {
  const b = r.querySelector(`button[data-pagina="${id}"]`);
  act(() => b.click());
}

test('la risposta dell’AD «su misura» passa i paletti: niente «nessuna percentuale», niente promesse fuori fascia', () => {
  const r = pulisci({ su_misura: {
    base: { perche: 'Con il Base il forno è online in due settimane, col pane del giorno.', foto_video: 'Nel Base 2 video al mese del pane appena sfornato.', sito_web: 'Il sito di oggi non si legge dal telefono: lo rifacciamo in una pagina.', social: 'Con noi nessuna percentuale e 8 post al mese.', analisi: 'I video arrivano dal Business: nel Base l’analisi all’avvio.' },
    business: { perche: 'Più clienti la mattina.', foto_video: '', sito_web: 'Più pagine, col listino delle focacce.', social: 'Le storie ogni giorno.', analisi: 'Ogni mese i 3 forni vicini.' },
    premium: { perche: 'Il servizio completo.', social: 'Storie ogni giorno e 20 post.', strano: 'non esiste' },
    gold: { perche: 'fascia che non esiste' },
  } });
  expect(r.su_misura.base.perche).toMatch(/online in due settimane/);
  expect(r.su_misura.base.servizi.sito_web).toMatch(/una pagina/);
  expect(r.su_misura.base.servizi.foto_video, 'il Base non dà video').toBeUndefined();
  expect(r.su_misura.base.servizi.social, '«nessuna percentuale» non arriva mai').toBeUndefined();
  expect(r.su_misura.base.servizi.analisi, 'un confronto col Business è ammesso').toMatch(/arrivano dal Business/);
  expect(r.su_misura.business.servizi.social, 'il Business non dà le storie').toBeUndefined();
  expect(r.su_misura.business.servizi.foto_video, 'una frase vuota la scrive il programma').toBeUndefined();
  expect(r.su_misura.premium.servizi.social).toMatch(/Storie ogni giorno/);
  expect(r.su_misura.premium.servizi.strano).toBeUndefined();
  expect(r.su_misura.gold).toBeUndefined();
  expect(r.scartati.filter((x) => /su misura/.test(x))).toHaveLength(3);
});

test('il programma scrive il sito su misura con la misura vera, e segue la tabella firmata fascia per fascia', () => {
  const semplice = prima(misura());
  const base = rigaSuMisura(semplice, 'base', 'sito_web');
  expect(base.daChi).toBe('programma');
  expect(base.testo).toMatch(/2 pagine/);
  expect(base.testo).toMatch(/non è protetto/);
  expect(base.testo).toMatch(/non è pensato per il telefono/);
  expect(base.testo).toMatch(/2018/);
  expect(base.testo).toMatch(/rifacciamo: una pagina/);
  expect(rigaSuMisura(semplice, 'business', 'sito_web').testo).toMatch(/più pagine/);
  expect(rigaSuMisura(semplice, 'premium', 'sito_web').testo).toMatch(/aggiorniamo noi ogni mese/);
  // Medio: nel Base si tiene, i difetti si sistemano dal Business. Di pregio: si rifà solo nel Premium.
  const medio = prima(misura({ stima: 'medio', pagine: 6 }));
  expect(rigaSuMisura(medio, 'base', 'sito_web').testo).toMatch(/si tiene.*dal Business/);
  const pregio = prima(misura({ stima: 'pregio', pagine: 12, https: true, telefonino: true, anno: 2026 }));
  expect(rigaSuMisura(pregio, 'business', 'sito_web').testo).toMatch(/È curato: nel Business si tiene/);
  expect(rigaSuMisura(pregio, 'business', 'sito_web').testo).not.toMatch(/2026|non è/);
  // Sito non visto: si chiede, e vale «medio».
  expect(rigaSuMisura(prima(), 'base', 'sito_web').testo).toMatch(/non l’abbiamo aperto: chiedi se c’è e com’è. Se c’è, nel Base si tiene/);
});

test('l’analisi su misura nomina i concorrenti veri, dal più vicino: uno nel Base, 3 nel Business, 5 nel Premium', () => {
  const s = prima();
  expect(rigaSuMisura(s, 'base', 'analisi').testo).toMatch(/7 attività dello stesso tipo entro 450 metri, la più vicina è Panificio Uno a 60 metri/);
  const business = rigaSuMisura(s, 'business', 'analisi').testo;
  expect(business).toMatch(/Panificio Uno \(60 m\), Panificio Due \(110 m\) e Panificio Tre \(150 m\)/);
  expect(business).not.toMatch(/Quattro/);
  const premium = rigaSuMisura(s, 'premium', 'analisi').testo;
  expect(premium).toMatch(/Panificio Cinque \(300 m\)/);
  expect(premium).not.toMatch(/Panificio Sei/);
  expect(rigaSuMisura(prima(null, osm([])), 'business', 'analisi'), 'senza concorrenti sulla mappa il programma non inventa').toBeNull();
});

test('i social su misura: un profilo mancante si dice solo dopo che l’AD l’ha cercato; i dati incerti e le critiche entrano', () => {
  const p = prima();
  expect(rigaSuMisura(p, 'base', 'social').testo).not.toMatch(/non l’abbiamo trovato/);
  expect(rigaSuMisura(p, 'base', 'social').testo, 'gli orari della mappa libera sono incerti').toMatch(/dati incerti: orari/);
  const s = unisci(p, pulisci({ social: [{ canale: 'Instagram', stato: 'non_trovato', fonte: null }, { canale: 'Facebook', stato: 'trovato', fonte: 'https://www.facebook.com/fornorossi', giudizio: 'Pagina poco viva', post_al_mese: 2, video: false }],
    reputazione: { sintesi: 'Pane buono.', positivi: ['Pane buono'], negativi: ['Coda lunga il sabato.'] } }));
  const base = rigaSuMisura(s, 'base', 'social').testo;
  expect(base).toMatch(/Oggi ha un profilo su Facebook; Instagram non l’abbiamo trovato/);
  expect(base).toMatch(/8 post al mese/);
  expect(rigaSuMisura(s, 'business', 'social').testo).toMatch(/12 post al mese, 2 sono video brevi.*«Coda lunga il sabato»/);
  expect(rigaSuMisura(s, 'premium', 'social').testo).toMatch(/20 post al mese, 4 video brevi e le storie/);
  expect(rigaSuMisura(s, 'business', 'foto_video').testo).toMatch(/oggi sui suoi profili non abbiamo visto video/);
});

test('il programma rispetta le stesse regole dell’AD: nessuna sua riga promette fuori fascia o nega il 10%', () => {
  const schede = [prima(), prima(misura()), prima(misura({ stima: 'medio' })), prima(misura({ stima: 'pregio' })), prima(null, osm([])),
    unisci(prima(), pulisci({ sito: { livello: 'nessuno', giudizio: 'Nessun sito.', fonte: null }, social: [{ canale: 'Instagram', stato: 'non_trovato', fonte: null }] }))];
  let righe = 0;
  for (const s of schede) for (const id of ABBONAMENTI) for (const sv of SERVIZI_AGENZIA) {
    const r = rigaSuMisura(s, id, sv);
    if (!r) continue;
    righe += 1;
    expect(promessaFuoriFascia(id, r.testo), `${id} · ${sv}: ${r.testo}`).toBe(false);
    expect(negaIlDieciPerCento(r.testo), `${id} · ${sv}: ${r.testo}`).toBe(false);
    for (const frase of r.testo.split(/(?<=[.:;])\s+/)) expect(frase.split(/\s+/).length, frase).toBeLessThanOrEqual(30);
  }
  expect(righe).toBeGreaterThan(60);
});

test('nelle tre schede ogni servizio ha la riga «Per <negozio>»: dal programma subito, poi quella dell’AD vince', () => {
  const p = prima(misura());
  const { radice, ridisegna } = disegna(p);
  scegli(radice, 'abbonamenti');
  for (const id of ABBONAMENTI) {
    const scheda = radice.querySelector(`[data-fascia="${id}"]`);
    const righe = [...scheda.querySelectorAll('[data-su-misura]')];
    expect(righe.map((x) => x.getAttribute('data-su-misura')), id).toEqual(['programma', 'programma', 'programma', 'programma']);
    expect(righe[0].textContent).toMatch(/^Per Forno Rossi:/);
    expect(scheda.textContent, 'il listino resta').toContain(LISTINO[id].servizi.social);
  }
  expect(radice.textContent).toMatch(/le sta completando l’AD/);
  const ad = pulisci({ consigliato: 'business', perche_consigliato: 'Serve più gente al mattino.', su_misura: {
    base: { perche: 'Online in due settimane.', foto_video: '', sito_web: '', social: '', analisi: '' },
    business: { perche: 'Il sabato c’è la coda: con le prenotazioni dal sito la coda si accorcia.', foto_video: 'Un video al mese della prima infornata delle 6.', sito_web: 'Il sito di 2 pagine diventa un sito con il listino delle focacce.', social: '', analisi: '' },
    premium: { perche: '', foto_video: '', sito_web: '', social: '', analisi: '' },
  } });
  ridisegna(unisci(p, ad));
  expect(radice.querySelector('button[aria-current="page"]')?.getAttribute('data-pagina'), 'la pagina scelta resta quando arriva la risposta dell’AD').toBe('abbonamenti');
  const business = radice.querySelector('[data-fascia="business"]');
  expect(business.querySelector('[data-su-misura="perche"]').textContent).toMatch(/Cosa ci guadagna Forno Rossi: Il sabato c’è la coda/);
  const righe = [...business.querySelectorAll('[data-su-misura]:not([data-su-misura="perche"])')];
  expect(righe.map((x) => x.getAttribute('data-su-misura'))).toEqual(['AD', 'AD', 'programma', 'programma']);
  expect(righe[0].textContent).toMatch(/prima infornata delle 6/);
  expect(radice.querySelector('[data-fascia="premium"] [data-su-misura="perche"]'), 'un perché vuoto non si mostra').toBeNull();
  expect(radice.textContent).not.toMatch(/le sta completando l’AD/);
});

test('il compito chiede all’AD la parte su misura per ogni fascia, col listino vero e lo schema che la pretende', () => {
  expect(SCHEMA.required).toContain('su_misura');
  for (const id of ABBONAMENTI) {
    expect(SCHEMA.properties.su_misura.properties[id].required).toEqual(['perche', 'foto_video', 'sito_web', 'social', 'analisi']);
    for (const sv of SERVIZI_AGENZIA) expect(COMPITO, `${id} · ${sv}`).toContain(LISTINO[id].servizi[sv]);
  }
  expect(COMPITO.length).toBeLessThan(30000); // il tetto di «Controlla il lavoro» del flusso 14
});

test('percheSuMisura viene solo dall’AD: il programma non inventa cosa ci guadagna il negozio', () => {
  for (const id of ABBONAMENTI) expect(percheSuMisura(prima(misura()), id)).toBeNull();
});

// Il collaudo del 27/11 (difetto 1): «senza togliere nulla» vale anche dentro le sezioni, non solo per i titoli.
test('le frasi fisse di prima ci sono ancora, ognuna nella sua pagina', () => {
  const s = unisci(prima(), pulisci(JSON.parse(readFileSync(path.resolve(__dirname, 'dolce-dispensa-ad.json'), 'utf8'))), []);
  const { radice } = disegna(s);
  const testo = {};
  for (const id of ['breve', 'abbonamenti', 'domande', 'online', 'reputazione', 'dati']) { scegli(radice, id); testo[id] = radice.textContent; }
  expect(testo.breve).toContain('Il gancio per aprire:');
  expect(testo.breve).toContain(s.gancio);
  expect(testo.breve).toContain('Sui prodotti venduti tramite MyCity resta il 10%; al banco niente. Oggi si paga in contanti, di persona.');
  expect(testo.breve).toContain('Perché il Base:'); // 27/11: le offerte stanno nella prima pagina
  for (const h of ['Voce', 'Valore', 'Quanto è sicuro', 'Fonte']) expect(testo.dati).toContain(h);
  for (const t of Object.values(testo)) expect(t).toContain('Consigliato: Base · 300 € al mese');
  const { radice: r2 } = disegna(prima());
  scegli(r2, 'online');
  expect(r2.textContent).toContain('Instagram, Facebook e TikTok li sta cercando l’AD…');
});

// ———————————————— Il secondo collaudo del 27/11: 2 gravi e 8 minori, ognuno con la sua prova.

/** I 28 casi del collaudatore: 18 promesse fuori fascia che passavano, 10 frasi giuste che venivano scartate. */
const FUORI = [
  ['base', 'Nel Base 2 video al mese del pane, non dovete fare niente voi.'],
  ['base', 'Le storie su Instagram ogni giorno, senza che dobbiate pensarci.'],
  ['base', 'Con il Base i video della pasta fresca su Instagram, ogni settimana.'],
  ['base', 'Giriamo i reel del forno appena sfornato.'],
  ['base', 'Le stories di Instagram ogni mattina con il pane del giorno.'],
  ['base', 'Il sito diventa di tre pagine: chi siamo, menu e contatti.'],
  ['base', 'Un sito di 5 pagine col menu delle torte.'],
  ['base', 'Più pagine sul sito, non solo la home.'],
  ['base', 'Un video del laboratorio all’avvio, nessun costo in più.'],
  ['base', 'Ogni mese l’analisi dei 3 forni vicini e un incontro per leggerla insieme.'],
  ['base', '20 post al mese e le risposte alle recensioni scritte da noi.'],
  ['business', 'Una persona dedicata tutta per voi, che passa in negozio ogni mese.'],
  ['business', 'Una visita nella vostra bottega ogni mese per le foto.'],
  ['business', 'Le stories ogni giorno con le novità.'],
  ['business', 'Le storie ogni giorno, non solo i post.'],
  ['business', 'Un referente che non vi lascia mai soli.'],
  ['business', '4 video brevi al mese e l’analisi ogni settimana.'],
  ['business', 'Veniamo a trovarvi ogni mese in pasticceria.'],
];
const GIUSTE = [
  ['base', 'Oggi il sito ha più pagine ma è lento: nel Base si tiene e si collega alla vetrina.'],
  ['base', 'Oggi pubblica due video al mese su Instagram: nel Base pensiamo alle foto e ai post.'],
  ['base', 'Le storie del forno, aperto dal 1950, diventano i primi post.'],
  ['base', 'Il sito di oggi ha poche visite: lo rifacciamo in una pagina, collegata alla vetrina.'],
  ['base', 'Una pagina col suo nome, con gli orari delle visite oculistiche.'],
  ['base', 'Oggi sul profilo ci sono 0 video: partiamo dalle foto dei prodotti.'],
  ['business', 'Oggi pubblica le storie ogni giorno: aggiungiamo 12 post e 2 video brevi al mese.'],
  ['business', 'Con la vetrina in evidenza, più visite al negozio il sabato mattina.'],
  ['business', 'Le visite nel locale crescono con il sito di più pagine e il menu.'],
  ['business', 'Raccontiamo le storie dei clienti affezionati nei 12 post al mese.'],
  ['base', 'Nel Base niente video, storie o più pagine: quelli arrivano dal Business.'],
  ['premium', 'Le storie ogni giorno, 4 video brevi e una visita nel locale ogni mese.'],
];
test('grave 2: il controllo delle promesse non si aggira con un «non» e non scarta le frasi giuste', () => {
  for (const [id, t] of FUORI) expect(promessaFuoriFascia(id, t), `${id}: ${t}`).toBe(true);
  for (const [id, t] of GIUSTE) expect(promessaFuoriFascia(id, t), `${id}: ${t}`).toBe(false);
});

test('grave 1: «medio» senza aver aperto il sito non diventa un fatto; con la misura vale la stima del programma', () => {
  // L'AD scrive «medio» perché non sa (il compito glielo chiede): niente «Secondo l'AD è curato».
  const nonSa = unisci(prima(), pulisci({ sito: { livello: 'medio', giudizio: 'Non so se c’è.', fonte: null } }));
  for (const id of ABBONAMENTI) {
    expect(rigaSuMisura(nonSa, id, 'sito_web').testo).toMatch(/non l’abbiamo aperto: chiedi/);
    expect(rigaSuMisura(nonSa, id, 'sito_web').testo).not.toMatch(/Secondo l’AD/);
  }
  // L'AD l'ha guardato davvero (fonte https) e dice «semplice»: vale il suo giudizio.
  const visto = unisci(prima(), pulisci({ sito: { livello: 'semplice', giudizio: 'Una pagina fatta in casa.', fonte: 'https://www.fornorossi.it/' } }));
  expect(rigaSuMisura(visto, 'base', 'sito_web').testo).toMatch(/Secondo l’AD il sito di oggi è semplice.*rifacciamo: una pagina/);
  // Il sito misurato DOPO la risposta dell'AD (app/api/agente/stato): «medio» dell'AD non copre la stima «semplice».
  const dopo = unisci(prima(), pulisci({ sito: { livello: 'medio', giudizio: 'Forse c’è.', fonte: null } }));
  dopo.sito.misura = misura({ stima: 'semplice', pagine: 1, piattaforma: 'Jimdo', anno: 2016 });
  expect(rigaSuMisura(dopo, 'base', 'sito_web').testo).toMatch(/1 pagina.*2016.*rifacciamo/);
  // «nessuno» dell'AD con un sito misurato dopo: vale la misura (qui un sito medio di 5 pagine, che nel Base si tiene).
  const nessuno = unisci(prima(), pulisci({ sito: { livello: 'nessuno', giudizio: 'Non c’è.', fonte: null } }));
  nessuno.sito.misura = misura({ stima: 'medio', pagine: 5, https: true, telefonino: true, anno: 2026 });
  expect(rigaSuMisura(nessuno, 'base', 'sito_web').testo).toMatch(/5 pagine\. Nel Base si tiene/);
  // Di pregio coi difetti: nel Business si tiene e i difetti si sistemano col Premium; il Premium non promette di rifarlo.
  const pregio = unisci(prima(misura({ stima: 'medio' })), pulisci({ sito: { livello: 'pregio', giudizio: 'Bello.', fonte: 'https://www.fornorossi.it/' } }));
  expect(rigaSuMisura(pregio, 'business', 'sito_web').testo).toMatch(/difetti di oggi si sistemano col Premium/);
  expect(rigaSuMisura(pregio, 'premium', 'sito_web').testo).toMatch(/lo aggiorniamo noi ogni mese/);
  expect(rigaSuMisura(pregio, 'premium', 'sito_web').testo).not.toMatch(/rif/);
});

test('minore 3: la tabella dei social vale anche per il programma (profilo forte, profilo attivo, chi risponde già)', () => {
  const forte = unisci(prima(), pulisci({ social: [{ canale: 'Instagram', stato: 'trovato', livello: 'forte', post_al_mese: 25, video: true, fonte: 'https://www.instagram.com/fornorossi', giudizio: 'Molto vivo, risponde sempre alle recensioni' }] }));
  expect(rigaSuMisura(forte, 'base', 'social').testo).toMatch(/solo col Premium/);
  expect(rigaSuMisura(forte, 'base', 'social').testo).not.toMatch(/8 post/);
  expect(rigaSuMisura(forte, 'business', 'social').testo).not.toMatch(/risposte alle recensioni le scriviamo/);
  expect(rigaSuMisura(forte, 'premium', 'social').testo).toMatch(/aggiungiamo a quello che fa già le storie/);
  const attivo = unisci(prima(), pulisci({ social: [{ canale: 'Facebook', stato: 'trovato', livello: 'attivo', post_al_mese: 10, video: true, fonte: 'https://www.facebook.com/fornorossi', giudizio: 'Curato' }] }));
  expect(rigaSuMisura(attivo, 'base', 'social').testo).toMatch(/circa 10 post al mese: il Base non ne fa di più, la gestione conviene col Business/);
  expect(rigaSuMisura(attivo, 'business', 'social').testo).toMatch(/12 post al mese/);
});

test('minore 6: un profilo della mappa libera è «da controllare», e «partendo da zero» non c’è più', () => {
  const o = osm(); o.luogo.instagram = 'https://www.instagram.com/fornorossi';
  const s = prima(null, o);
  const r = rigaSuMisura(s, 'base', 'social').testo;
  expect(r).toMatch(/sulla mappa libera c’è un profilo Instagram, da controllare/i);
  expect(r).not.toMatch(/Oggi ha un profilo/);
  for (const id of ABBONAMENTI) expect(rigaSuMisura(unisci(prima(), pulisci({ social: [{ canale: 'Instagram', stato: 'non_trovato', fonte: null }] })), id, 'social').testo).not.toMatch(/da zero/);
});

test('minore 7: il doppione del negozio sulla mappa non è un concorrente, e i nomi lunghi si accorciano', () => {
  const lungo = 'Antica Pasticceria e Panetteria Artigianale della Famiglia Bianchi dal 1890';
  const s = prima(null, osm([{ nome: 'Forno Rossi', tipo: 'Panetteria', distanza: 4, fonte: 'https://www.openstreetmap.org/node/8' }, { nome: lungo, tipo: 'Panetteria', distanza: 90, fonte: 'https://www.openstreetmap.org/node/7' }]));
  const r = rigaSuMisura(s, 'base', 'analisi').testo;
  expect(r).not.toMatch(/Forno Rossi/);
  expect(r).toMatch(/la più vicina è Antica Pasticceria e Panetteria Artigia… a 90 metri/);
});

test('minore 4: il «perché» e le proposte su misura passano anche dai paletti su 10% e gioco', () => {
  const r = pulisci({ su_misura: {
    base: { perche: 'Con noi nessuna percentuale sul venduto.', foto_video: '', sito_web: '', social: '', analisi: '' },
    premium: { perche: 'Più clienti.', foto_video: '', sito_web: '', social: 'Post sul Superenalotto ogni settimana.', analisi: '' },
  } });
  expect(r.su_misura?.base?.perche ?? null).toBeNull();
  expect(r.su_misura.premium.servizi.social).toBeUndefined();
  expect(r.scartati.some((x) => /su misura del Premium \(social e Google\)/.test(x))).toBe(true);
});

test('minore 9: una scheda già unita che ripassa da normalizza tiene le righe dell’AD', () => {
  const s = unisci(prima(), pulisci({ su_misura: { business: { perche: 'Più clienti la mattina.', foto_video: 'Un video al mese della prima infornata.', sito_web: '', social: '', analisi: '' } } }));
  const n = normalizza(JSON.parse(JSON.stringify(s)));
  expect(n.su_misura.business.servizi.foto_video).toBe('Un video al mese della prima infornata.');
  expect(n.su_misura.business.perche).toBe('Più clienti la mattina.');
});
