// @vitest-environment jsdom
// @ts-nocheck — i dati finti della scheda (come in scheda.test.ts) non portano i tipi.
//
// LA SCHEDA A PAGINE E LE TRE SCHEDE DEGLI ABBONAMENTI — Nicola, 26/11/2026: «crea le 3 schede dell'abbonamento
// in cui inserisci i benefici in base all'abbonamento, e siccome la pagina diventa troppo lunga, dividile in più
// pagine dentro un menù a tendina», «senza togliere nulla di quello che c'è».
// Sul codice di prima queste prove sono rosse: non c'era il menu a tendina né la pagina dei tre abbonamenti.
// Diventano rosse anche se una sezione di prima sparisce, o se un beneficio della scheda si separa dal listino del sito.
import { afterEach, expect, test } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Scheda, { PAGINE } from '@/components/agenti/Scheda';
import { primaScheda, pulisci, unisci } from '@/lib/agenti/scheda';
import { FASCE as LISTINO, LISTINO as VOCI, SERVIZI_AGENZIA, ABBONAMENTI } from '@/lib/agenzia/preventivo';
import { euro } from '@/lib/agenti/fasce';

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

const tendina = (r) => r.querySelector('select#pagina-scheda');
function scegli(r, id) {
  const sel = tendina(r);
  act(() => { sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true })); });
}
const titoli = (r) => [...r.querySelectorAll('h2')].map((h) => h.textContent.trim());
const premi = (r, testo) => {
  const b = [...r.querySelectorAll('button')].find((x) => x.textContent.includes(testo));
  expect(b, `il bottone «${testo}»`).toBeTruthy();
  act(() => b.click());
};

test('la scheda si apre sulla prima pagina e il menu a tendina elenca tutte le pagine, con i tre abbonamenti', () => {
  const r = disegna(intera());
  const sel = tendina(r);
  expect(sel, 'il menu a tendina').toBeTruthy();
  expect([...sel.options].map((o) => o.value)).toEqual(PAGINE.map((p) => p.id));
  expect(PAGINE.map((p) => p.id)).toContain('abbonamenti');
  expect(sel.value).toBe('breve');
  expect(r.textContent).toContain('In 30 secondi, prima di entrare');
  // Una pagina sola alla volta: la prima non porta le sezioni delle altre.
  expect(titoli(r)).toEqual(['Cosa ha, cosa non ha, cosa va migliorato']);
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

test('«Avanti», «indietro» e il bottone dell’offerta portano alla pagina giusta', () => {
  const r = disegna(intera());
  premi(r, 'Avanti: Cosa offrire');
  expect(tendina(r).value).toBe('offerta');
  expect(titoli(r)).toContain('Cosa possiamo offrire, e perché');
  premi(r, 'Apri le tre schede degli abbonamenti');
  expect(tendina(r).value).toBe('abbonamenti');
  premi(r, '‹ Cosa offrire');
  expect(tendina(r).value).toBe('offerta');
  scegli(r, 'dati');
  expect([...r.querySelectorAll('button')].some((b) => b.textContent.startsWith('Avanti'))).toBe(false);
});

test('mentre l’AD scrive, le tre schede ci sono già, senza un consigliato inventato', () => {
  const r = disegna(prima());
  scegli(r, 'abbonamenti');
  expect(r.querySelectorAll('[data-fascia]')).toHaveLength(3);
  expect(r.textContent).not.toContain('Consigliato dall’AD');
});
