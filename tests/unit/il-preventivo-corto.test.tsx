/**
 * @vitest-environment jsdom
 */
/**
 * 25/11/2026 — IL PREVENTIVO CORTO.
 *
 * Nicola, 18:30: «dentro il preventivo la descrizione dei servizi deve essere corta e con lo stretto
 * necessario che gli interessa». Scelta dell'AD: `FASCE` e `LISTINO` restano interi (vivono anche nel
 * database e nel flusso 19); solo il preventivo mostra la forma corta.
 *  · i tre abbonamenti: nome, prezzo e per chi; i servizi una riga ciascuno, solo per la fascia guardata;
 *  · l'offerta su misura: solo le proposte nate da un dato vero, una frase ciascuna;
 *  · le righe corte non inventano quantità: ogni numero che dicono è scritto anche in `FASCE`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { offertaSuMisura, type DatiPerLOfferta } from '@/lib/agenzia/offerta-su-misura';
import { ABBONAMENTI, FASCE, SERVIZI_AGENZIA, type Abbonamento } from '@/lib/agenzia/preventivo';
import { SERVIZI_IN_BREVE } from '@/lib/agenzia/preventivo-corto';
import OffertaSuMisura from '@/components/seller/OffertaSuMisura';
import AbbonamentiInBreve from '@/components/seller/AbbonamentiInBreve';

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});
async function monta(el: React.ReactElement) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(el); });
  return radice;
}

// Un bar senza foto, senza video, senza sito e senza scheda Google: tante proposte, alcune senza un dato vero.
const BAR: DatiPerLOfferta = {
  nome: 'La Ragazzetta',
  tipo: 'bar',
  dati: {
    storeLogo: null,
    storeMedia: [],
    prodotti: [{ images: [] }, { images: ['https://x.it/p.jpg'] }, { images: [] }],
    socials: { instagram: 'laragazzetta' },
  },
};
const PREZZI: Record<Abbonamento, number> = { base: 30_000, business: 50_000, premium: 99_900 };

describe('l offerta su misura, corta', () => {
  it('solo le proposte con un dato vero, una frase ciascuna, niente riepilogo né domande né «in più»', async () => {
    const o = offertaSuMisura(BAR);
    // le proposte senza un dato vero ci sono nell'offerta intera…
    expect(o.proposte.map((x) => x.id)).toEqual(expect.arrayContaining(['analisi', 'google-scheda']));
    const r = await monta(createElement(OffertaSuMisura, { offerta: o, fascia: 'base', corta: true }));
    // …ma nel preventivo no
    expect(r.querySelector('[data-proposta="analisi"]')).toBeNull();
    expect(r.querySelector('[data-proposta="google-scheda"]')).toBeNull();
    const voci = [...r.querySelectorAll('[data-proposta]')];
    expect(voci.map((v) => v.getAttribute('data-proposta'))).toEqual(expect.arrayContaining(['foto-prodotti', 'foto-copertina']));
    for (const v of voci) {
      const x = o.proposte.find((p) => p.id === v.getAttribute('data-proposta'))!;
      // una frase: il perché lungo non si stampa
      expect(v.textContent).not.toContain(x.perche);
      expect(v.querySelectorAll('p').length).toBeLessThanOrEqual(1);
    }
    expect(r.querySelector('[data-testid="offerta-riepilogo"]')).toBeNull();
    expect(r.querySelector('[data-testid="offerta-in-piu"]')).toBeNull();
    expect(r.textContent).not.toContain('Al primo incontro ti chiediamo');
  });

  it('se restano solo proposte senza dato vero, la sezione non si disegna', async () => {
    const vuota: DatiPerLOfferta = { ...BAR, dati: { ...BAR.dati, storeMedia: [{ type: 'image', url: 'a' }, { type: 'image', url: 'b' }, { type: 'image', url: 'c' }, { type: 'video', url: 'v' }], prodotti: [], socials: { instagram: 'x', website: 'https://x.it' } } };
    const r = await monta(createElement(OffertaSuMisura, { offerta: offertaSuMisura(vuota), fascia: 'base', corta: true }));
    expect(r.querySelector('#offerta-su-misura')).toBeNull();
  });

  it('fuori dal preventivo l offerta resta intera', async () => {
    const r = await monta(createElement(OffertaSuMisura, { offerta: offertaSuMisura(BAR), fascia: 'base' }));
    expect(r.querySelector('[data-proposta="analisi"]')).not.toBeNull();
    expect(r.querySelector('[data-testid="offerta-riepilogo"]')).not.toBeNull();
  });
});

describe('i tre abbonamenti, in breve', () => {
  it('i servizi una riga ciascuno, solo per la fascia guardata', async () => {
    const r = await monta(createElement(AbbonamentiInBreve, { consigliato: 'business', prezzi: PREZZI, primoMeseScontato: false, perche: 'Perché sì.' }));
    // i tre prezzi ci sono
    for (const f of ABBONAMENTI) expect(r.querySelector(`[data-fascia="${f}"]`)).not.toBeNull();
    // i servizi solo del Business, una riga ciascuno
    const righe = [...r.querySelectorAll('[data-servizio]')];
    expect(righe).toHaveLength(SERVIZI_AGENZIA.length);
    for (const s of SERVIZI_AGENZIA) expect(r.querySelector(`[data-servizio="${s}"]`)!.textContent).toContain(SERVIZI_IN_BREVE.business[s]);
    // le descrizioni lunghe del listino non si stampano
    for (const f of ABBONAMENTI) for (const s of SERVIZI_AGENZIA) expect(r.textContent).not.toContain(FASCE[f].servizi[s]);
    expect(r.textContent).toContain('Perché consigliamo Business');
  });

  it('le righe corte sono corte e non inventano quantità: ogni numero è anche in FASCE', () => {
    for (const f of ABBONAMENTI) {
      for (const s of SERVIZI_AGENZIA) {
        const corta = SERVIZI_IN_BREVE[f][s];
        expect(corta.length, `${f}/${s}`).toBeLessThanOrEqual(60);
        expect(corta.length).toBeLessThan(FASCE[f].servizi[s].length);
        for (const n of corta.match(/\d+/g) ?? []) expect(FASCE[f].servizi[s], `${f}/${s}: ${n}`).toMatch(new RegExp(`\\b${n}\\b`));
      }
    }
  });
});
