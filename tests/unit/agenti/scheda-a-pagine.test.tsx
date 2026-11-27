// @vitest-environment jsdom
// @ts-nocheck — i dati finti della scheda (come in scheda.test.ts) non portano i tipi.
//
// LA SCHEDA A PAGINE E LE TRE SCHEDE DEGLI ABBONAMENTI — Nicola, 26/11/2026: «crea le 3 schede dell'abbonamento
// in cui inserisci i benefici in base all'abbonamento, e siccome la pagina diventa troppo lunga, dividile in più
// pagine dentro un menù a tendina», «senza togliere nulla di quello che c'è».
// Sul codice di prima queste prove sono rosse: non c'era il menu a tendina né la pagina dei tre abbonamenti.
// Diventano rosse anche se una sezione di prima sparisce, o se un beneficio della scheda si separa dal listino del sito.
//
// 27/11/2026 — Nicola: «inserisci cosa possiamo offrire e perché dentro la scheda cosa ha e non ha», «elimina le 3
// schede abbonamento». Le offerte stanno nella prima pagina (la pagina «Cosa offrire» non c'è più) e i tre riquadri
// riassuntivi Base/Business/Premium sotto le offerte spariscono. Sul codice di prima la prova qui sotto è rossa.
// Subito dopo: «migliora il menu, in questo modo è scomodo». La tendina tagliava il titolo e chiedeva due tocchi:
// ora le parti sono bottoni corti, tutti in vista. La prova del menu è rossa sulla tendina di prima.
import { afterEach, expect, test } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Scheda, { PAGINE } from '@/components/agenti/Scheda';
import { primaScheda, pulisci, unisci } from '@/lib/agenti/scheda';
import { FASCE as LISTINO, LISTINO as VOCI, SERVIZI_AGENZIA, ABBONAMENTI } from '@/lib/agenzia/preventivo';
import { FASCE, ID_FASCE, euro } from '@/lib/agenti/fasce';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const letto = { nome: 'La Dolce Dispensa', indirizzo: 'Via Roma 1, 29121 Piacenza', lat: 45.05, lon: 9.69, idLuogo: null, link: 'https://www.google.com/maps/place/Dolce/@45.05,9.69,17z' };
const osm = { lat: 45.05, lon: 9.69, indirizzo: null, luogo: { nome: 'La Dolce Dispensa', tipo: 'Pasticceria', chiave: 'shop=pastry', distanza: 5, fonte: 'https://www.openstreetmap.org/node/1', indirizzo: null, telefono: null, sito: null, orari: null, instagram: null, facebook: null },
  concorrenti: [{ nome: 'Pasticceria Vicina', tipo: 'Pasticceria', distanza: 120, fonte: 'https://www.openstreetmap.org/node/2' }], concorrentiContati: 3, raggio: 450, avvisi: [] };
const prima = () => primaScheda({ letto, osm, misura: null, citta: 'Piacenza', data: '2026-11-26 18:00' });
/** La scheda intera con la risposta vera dell'AD del 26/11 (consigliato: Base). */
const intera = () => unisci(prima(), pulisci(JSON.parse(readFileSync(path.resolve(__dirname, 'dolce-dispensa-ad.json'), 'utf8'))), []);

/** Le sezioni della scheda prima delle pagine (26/11, mycity#340): nessuna deve sparire. */
const SEZIONI_DI_PRIMA = [
  'Cosa ha, cosa non ha, cosa va migliorato', 'Cosa possiamo offrire, e perché', 'Domande da fare al titolare', 'Obiezioni probabili',
  'Attenzione', 'Sito e social di oggi', 'Reputazione', 'Concorrenti vicini', 'Potenziale', 'I dati dell’attività', 'Fonti e avvisi',
];

const aperti = [];
function disegna(s) {
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  act(() => root.render(<Scheda s={s} />));
  aperti.push({ root, radice });
  return radice;
}
afterEach(() => { for (const { root, radice } of aperti.splice(0)) { act(() => root.unmount()); radice.remove(); } });

const voci = (r) => [...r.querySelectorAll('nav[aria-label="Parti della scheda"] button[data-pagina]')];
/** La parte aperta: la voce del menu segnata come pagina corrente. */
const aperta = (r) => voci(r).find((b) => b.getAttribute('aria-current') === 'page')?.getAttribute('data-pagina');
function scegli(r, id) {
  const b = voci(r).find((x) => x.getAttribute('data-pagina') === id);
  expect(b, `la voce «${id}» del menu`).toBeTruthy();
  act(() => b.click());
}
const titoli = (r) => [...r.querySelectorAll('h2')].map((h) => h.textContent.trim());
const premi = (r, testo) => {
  const b = [...r.querySelectorAll('button')].find((x) => x.textContent.includes(testo));
  expect(b, `il bottone «${testo}»`).toBeTruthy();
  act(() => b.click());
};

test('la scheda si apre sulla prima pagina e il menu elenca tutte le pagine, con i tre abbonamenti', () => {
  const r = disegna(intera());
  expect(voci(r).map((b) => b.getAttribute('data-pagina'))).toEqual(PAGINE.map((p) => p.id));
  expect(PAGINE.map((p) => p.id)).toContain('abbonamenti');
  expect(aperta(r)).toBe('breve');
  expect(r.textContent).toContain('In 30 secondi, prima di entrare');
  // Una pagina sola alla volta: la prima porta «cosa ha» e, subito sotto, «cosa offrire» (27/11); niente delle altre.
  expect(titoli(r)).toEqual(['Cosa ha, cosa non ha, cosa va migliorato', 'Cosa possiamo offrire, e perché']);
  // Testata e piede restano in vista su ogni pagina.
  expect(r.querySelector('h1').textContent).toBe('La Dolce Dispensa');
  expect(r.textContent).toContain('© OpenStreetMap contributors');
});

test('nessuna sezione di prima è sparita: girando tutte le pagine si ritrovano tutte, ognuna una volta sola', () => {
  const r = disegna(intera());
  const viste = [];
  for (const p of PAGINE) { scegli(r, p.id); viste.push(...titoli(r)); expect(r.textContent).toContain('© OpenStreetMap contributors'); }
  for (const t of SEZIONI_DI_PRIMA) expect(viste.filter((v) => v === t), `«${t}»`).toHaveLength(1);
  expect(viste).toContain('I tre abbonamenti');
});

test('le tre schede degli abbonamenti portano prezzo, primo mese e tutti i benefici del listino, diversi per fascia', () => {
  const s = intera();
  const r = disegna(s);
  scegli(r, 'abbonamenti');
  const schede = [...r.querySelectorAll('[data-fascia]')];
  expect(schede.map((x) => x.getAttribute('data-fascia'))).toEqual([...ABBONAMENTI]);
  for (const el of schede) {
    const id = el.getAttribute('data-fascia');
    const f = LISTINO[id];
    const testo = el.textContent;
    expect(testo).toContain(f.nome);
    expect(testo).toContain(euro(f.prezzoMese));
    expect(testo).toContain(`Il primo mese ${euro(f.prezzoMese / 2)}`);
    expect(testo).toContain(f.perChi);
    const voci = [...el.querySelectorAll('[data-voce]')];
    expect(voci).toHaveLength(SERVIZI_AGENZIA.length + 2);
    for (const sv of SERVIZI_AGENZIA) {
      const v = voci.find((x) => x.getAttribute('data-voce') === VOCI[sv].titolo);
      expect(v?.textContent, `${id} · ${sv}`).toContain(f.servizi[sv]);
    }
    expect(testo).toContain(f.vetrina);
    expect(testo).toContain(f.assistenza);
  }
  // Le fasce non si copiano fra loro: i social del Base non sono quelli del Premium.
  expect(schede[0].textContent).not.toContain(LISTINO.premium.servizi.social);
  expect(schede[2].textContent).not.toContain(LISTINO.base.servizi.social);
  // La consigliata dall'AD (Base, per la Dolce Dispensa) si vede, col perché; le altre no.
  expect(s.consigliato).toBe('base');
  expect(schede[0].textContent).toContain('Consigliato dall’AD');
  expect(schede[0].textContent).toContain(s.perche_consigliato);
  expect(schede[1].textContent).not.toContain('Consigliato dall’AD');
  expect(schede[2].textContent).not.toContain('Consigliato dall’AD');
  // Le condizioni vere: il 10% sul venduto tramite MyCity resta, e oggi si paga in contanti.
  expect(r.textContent).toContain('resta il 10%');
  expect(r.textContent).toContain('in contanti');
});

test('il menu è comodo: tutte le parti in vista come bottoni dal nome corto, un tocco per cambiare, niente tendina (27/11)', () => {
  const r = disegna(intera());
  expect(r.querySelector('select'), 'la tendina di prima').toBeNull();
  expect(voci(r)).toHaveLength(PAGINE.length);
  // I nomi sul bottone sono corti e interi: niente «Reputazione, concorrenti e…» tagliato.
  for (const [i, b] of voci(r).entries()) { expect(b.textContent).toBe(PAGINE[i].corto); expect(b.textContent.length).toBeLessThanOrEqual(14); }
  for (const p of PAGINE) {
    scegli(r, p.id); // un tocco solo
    expect(aperta(r)).toBe(p.id);
    expect(voci(r).filter((b) => b.getAttribute('aria-current') === 'page')).toHaveLength(1);
    expect(r.textContent).toContain(`Parte della scheda · ${PAGINE.indexOf(p) + 1} di ${PAGINE.length}`);
  }
});

test('le offerte stanno nella prima pagina, senza i tre riquadri riassuntivi degli abbonamenti (27/11)', () => {
  const s = intera();
  const r = disegna(s);
  expect(PAGINE.map((p) => p.id)).not.toContain('offerta');
  expect(aperta(r)).toBe('breve');
  expect(s.offerta.length).toBeGreaterThan(0);
  for (const o of s.offerta) { expect(r.textContent).toContain(o.servizio); expect(r.textContent).toContain(o.perche); }
  expect(r.textContent).toContain(`Perché il ${FASCE[s.consigliato].nome}:`);
  expect(r.textContent).toContain('Sui prodotti venduti tramite MyCity resta il 10%; al banco niente. Oggi si paga in contanti, di persona.');
  // I tre riquadri «Base / Business / Premium · prezzo · piano · sito» non ci sono più, su nessuna pagina.
  for (const p of PAGINE) {
    scegli(r, p.id);
    for (const id of ID_FASCE) expect(r.textContent, `${p.id} · ${id}`).not.toContain(`${FASCE[id].inPratica.piano}. Sito:`);
  }
  // Nemmeno ridotti a nome e prezzo: fuori dalla testata (che porta il consigliato) la prima pagina non mostra listini.
  scegli(r, 'breve');
  const corpo = [...r.querySelectorAll('section')].map((x) => x.textContent).join(' ');
  for (const id of ID_FASCE) expect(corpo, `prezzo del ${FASCE[id].nome}`).not.toContain(euro(FASCE[id].centesimi));
});

test('mentre l’AD scrive, la prima pagina mostra già il posto delle offerte, col segnaposto e il bottone', () => {
  const r = disegna(prima());
  expect(aperta(r)).toBe('breve');
  const offerte = [...r.querySelectorAll('section')].find((x) => x.querySelector('h2')?.textContent === 'Cosa possiamo offrire, e perché');
  expect(offerte, 'la sezione delle offerte nella prima pagina').toBeTruthy();
  expect(offerte.querySelector('[aria-label="L’AD sta scrivendo questa parte"]'), 'il segnaposto «sta scrivendo»').toBeTruthy();
  expect(offerte.textContent).toContain('Apri le tre schede degli abbonamenti');
});

test('dopo «Avanti» e «indietro» il fuoco va sulla voce del menu della pagina nuova, non si perde', () => {
  const r = disegna(intera());
  premi(r, 'Avanti: I tre abbonamenti');
  expect(document.activeElement?.getAttribute('data-pagina')).toBe('abbonamenti');
  premi(r, '‹ In breve: cosa ha e cosa non ha');
  expect(document.activeElement?.getAttribute('data-pagina')).toBe('breve');
  // All'ultima pagina «Avanti» sparisce: il fuoco resta sul menu.
  scegli(r, 'reputazione');
  premi(r, 'Avanti: Dati e fonti');
  expect(document.activeElement?.getAttribute('data-pagina')).toBe('dati');
});

test('«Avanti», «indietro» e il bottone dell’offerta portano alla pagina giusta', () => {
  const r = disegna(intera());
  premi(r, 'Apri le tre schede degli abbonamenti');
  expect(aperta(r)).toBe('abbonamenti');
  premi(r, '‹ In breve: cosa ha e cosa non ha');
  expect(aperta(r)).toBe('breve');
  expect(titoli(r)).toContain('Cosa possiamo offrire, e perché');
  premi(r, 'Avanti: I tre abbonamenti');
  expect(aperta(r)).toBe('abbonamenti');
  scegli(r, 'dati');
  expect([...r.querySelectorAll('button')].some((b) => b.textContent.startsWith('Avanti'))).toBe(false);
});

test('mentre l’AD scrive, le tre schede ci sono già, senza un consigliato inventato', () => {
  const r = disegna(prima());
  scegli(r, 'abbonamenti');
  expect(r.querySelectorAll('[data-fascia]')).toHaveLength(3);
  expect(r.textContent).not.toContain('Consigliato dall’AD');
});
