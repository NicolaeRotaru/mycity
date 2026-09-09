/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import {
  apriIlCruscotto, chiudiIlCruscotto, statisticheDelCruscotto,
} from './aiuti/cruscotto-del-negozio';

/**
 * 6/9/2026 — IL CRUSCOTTO SCARICAVA OGNI RIGA MAI VENDUTA, E SOPRA LE MILLE
 * SBAGLIAVA IN SILENZIO.
 *
 * Per riempire la targhetta «Articoli venduti» la pagina chiedeva al database
 * TUTTE le righe d'ordine del negozio: nessuna finestra di date, nessun ordine,
 * nessun limite. Il server però ne manda al massimo mille (`max_rows = 1000` in
 * supabase/config.toml) e non lo dice a nessuno: sceglie lui quali, e il
 * browser le conta come se fossero tutte.
 *
 * Il conto di un panificio con 1.200 righe da gennaio: apre il cruscotto e
 * legge un numero fermo, più basso del vero, proprio nel mese in cui ha venduto
 * di più. In più ogni apertura si trascinava mille righe con dentro i dati
 * dell'ordine fino al telefono, per mostrare un numero solo.
 *
 * Il 22/8 lo stesso difetto era stato chiuso sulla query gemella (gli ordini):
 * questa, due righe sopra, era rimasta com'era.
 *
 * Adesso: finestra di trenta giorni come la gemella, tetto scritto in chiaro, e
 * — la parte che toglie il silenzio — se il tetto viene toccato la targhetta
 * mette il più («137+») invece di spacciare un numero mozzato per il totale.
 *
 * QUELLO CHE QUESTA PROVA NON PUÒ FARE: da qui non c'è un database vero, quindi
 * non semina 1.200 righe per guardare cosa torna. Prova due cose che stanno
 * tutte in casa: che a schermo il tetto si vede, e che la lettura non è più
 * senza confini.
 */


/** La targhetta che porta questa scritta, letta com'è a video. */
function targhetta(radice: HTMLElement, etichetta: string) {
  const riga = Array.from(radice.querySelectorAll('p')).find(
    (p) => (p.textContent ?? '').trim() === etichetta,
  );
  const scheda = riga?.parentElement;
  return {
    valore: scheda?.querySelector('p')?.textContent?.trim() ?? '',
    // Le tre righe della scheda: valore, etichetta, spiegazione.
    spiegazione: Array.from(scheda?.querySelectorAll('p') ?? []).at(-1)?.textContent?.trim() ?? '',
  };
}

describe('la targhetta «Articoli venduti» del cruscotto', () => {
  afterEach(chiudiIlCruscotto);

  it('dice la finestra che ha davvero letto, non «dall\'inizio»', async () => {
    apriIlCruscotto(statisticheDelCruscotto({ articoli: { quanti: 137, troncato: false } }));
    const mod = await monta('app/seller/dashboard/page.tsx');
    const s = accendi(mod.default as ComponentType);

    const t = targhetta(s.radice, 'Articoli venduti');
    expect(t.valore, 'il numero degli articoli non è più a video').toBe('137');
    expect(
      t.spiegazione,
      'diceva «Dall\'inizio» contando mille righe scelte dal server: o legge davvero dall\'inizio, o lo scrive',
    ).not.toMatch(/inizio/i);
    expect(t.spiegazione).toMatch(/30 giorni/i);
    s.smonta();
  }, 120000);

  it('quando la lettura tocca il tetto lo dice, invece di dare per buono un numero mozzato', async () => {
    apriIlCruscotto(statisticheDelCruscotto({ articoli: { quanti: 137, troncato: true } }));
    const mod = await monta('app/seller/dashboard/page.tsx');
    const s = accendi(mod.default as ComponentType);

    const t = targhetta(s.radice, 'Articoli venduti');
    expect(
      t.valore,
      'il negozio che ha superato il tetto legge un numero fermo e ci crede: qui ci vuole il più',
    ).toBe('137+');
    expect(t.spiegazione.toLowerCase()).toContain('almeno');
    s.smonta();
  }, 120000);
});

/** Il freno strutturale: la lettura non torna a essere senza confini. */
describe('la lettura del cruscotto del negozio', () => {
  const pagina = () => readFileSync('app/seller/dashboard/page.tsx', 'utf8');

  it('le righe d\'ordine si leggono con una finestra e un tetto scritti', () => {
    const righe = pagina().match(/from\('order_items'\)[\s\S]{0,600}?\)\s*,\n/);
    expect(righe, 'non trovo più la lettura delle righe d\'ordine').toBeTruthy();
    const query = righe![0];
    expect(
      query.includes(".gte('orders.created_at'"),
      'la lettura è di nuovo senza finestra: chiede ogni riga che il negozio abbia mai venduto',
    ).toBe(true);
    expect(
      /\.limit\(/.test(query),
      'senza limite scritto vale quello del server (mille righe) e non lo sa nessuno',
    ).toBe(true);
    expect(
      query.includes('orders!inner'),
      'senza `!inner` la data non filtra le righe: filtra solo l\'ordine annidato, e tornano tutte',
    ).toBe(true);
  });

  it('il voto medio lo somma il database, non il browser', () => {
    expect(
      pagina().includes("from('store_reviews')"),
      'le recensioni si leggono di nuovo tutte per farne una media, e sopra le mille si fermano in silenzio',
    ).toBe(false);
    expect(pagina().includes("rpc('store_review_stats'")).toBe(true);
  });
});
