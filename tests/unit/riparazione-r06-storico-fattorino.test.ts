/**
 * @vitest-environment jsdom
 */
/**
 * R06-015 / R06-016 (12/11/2026) — LO STORICO CONSEGNE DEL FATTORINO.
 *
 * R06-015: la chiave del gruppo era la data di Greenwich, l'etichetta l'ora del
 * telefono. Fra mezzanotte e l'una di Piacenza comparivano due gruppi e il
 * totale del giorno si spezzava.
 *
 * La lettura vera della pagina gira contro un finto database col tetto di mille
 * righe per richiesta; poi la pagina si disegna con quello che ha letto.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { creaPostgrestColTetto, type Riga } from './aiuti/riparazione-r06-postgrest-col-tetto';

type Lettura = { queryFn?: () => Promise<unknown> };
const globale = globalThis as Record<string, unknown>;

afterEach(() => {
  delete globale.__DATI_QUERY__;
  delete globale.__CLIENT_SUPABASE__;
  delete globale.__UTENTE__;
  vi.useRealTimers();
});

async function disegnaCon(consegne: Riga[]) {
  let lettura: Lettura | null = null;
  globale.__DATI_QUERY__ = (o: Lettura) => { lettura = o; return undefined; };
  const mod = await monta('app/rider/history/page.tsx');
  accendi(mod.default as ComponentType).smonta();
  globale.__UTENTE__ = { id: 'rider-1' };
  globale.__CLIENT_SUPABASE__ = creaPostgrestColTetto({ rider_consegne_storico: consegne }).client;
  const dati = await (lettura as unknown as Lettura).queryFn!();
  globale.__DATI_QUERY__ = dati;
  return accendi(mod.default as ComponentType);
}

function consegna(id: string, quando: string, euro = 3): Riga {
  return {
    id, rider_id: 'rider-1', total_price: 20, shipping_cost: 0, rider_fee_cents: euro * 100,
    delivery_status: 'DELIVERED', delivered_at: quando, delivery_city: 'Piacenza', payment_method: 'cod',
  };
}

describe('R06-015 · un solo «Oggi» dopo mezzanotte', () => {
  it('tre consegne fra mezzanotte e le due di Piacenza stanno in un gruppo solo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 12/11/2026 alle 01:30 a Piacenza (00:30 UTC).
    vi.setSystemTime(new Date('2026-11-12T00:30:00Z'));
    const s = await disegnaCon([
      consegna('c3', '2026-11-12T00:10:00Z'), // 01:10 a Piacenza
      consegna('c2', '2026-11-11T23:40:00Z'), // 00:40 a Piacenza
      consegna('c1', '2026-11-11T23:10:00Z'), // 00:10 a Piacenza
    ]);
    const etichette = [...s.radice.querySelectorAll('span.uppercase')].map((e) => e.textContent);
    expect(etichette, 'Le consegne dopo mezzanotte finivano in un secondo gruppo').toEqual(['Oggi']);
    expect(s.radice.textContent).toContain('9,00');
    s.smonta();
  }, 60000);
});

describe('R06-016 · storico lungo e consegne vecchie', () => {
  it('con 1200 consegne il totale e\' la somma vera, non quella delle prime mille righe', async () => {
    const adesso = Date.now();
    const consegne = Array.from({ length: 1200 }, (_, i) =>
      consegna(`k-${String(i).padStart(4, '0')}`, new Date(adesso - (i + 1) * 3600_000).toISOString(), 2));
    const s = await disegnaCon(consegne);
    const testo = s.radice.textContent ?? '';
    expect(testo, 'Conto e totale si fermavano alle mille righe che il database consegna in una volta').toContain('1200 consegne completate');
    expect(testo).toContain('2400,00');
    s.smonta();
  }, 60000);

  it('una consegna di otto giorni fa non porta a «Ordine non trovato»', async () => {
    const adesso = Date.now();
    const s = await disegnaCon([
      consegna('recente', new Date(adesso - 2 * 86_400_000).toISOString()),
      consegna('vecchia', new Date(adesso - 8 * 86_400_000).toISOString()),
    ]);
    const link = [...s.radice.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(link).toContain('/rider/orders/recente');
    expect(link, 'Dopo sette giorni la consegna non si apre piu\': il link portava a «Ordine non trovato»').not.toContain('/rider/orders/vecchia');
    expect(s.radice.textContent).toContain('#VECCHI');
    s.smonta();
  }, 60000);
});

describe('R06-016 · le recensioni del fattorino oltre le mille righe', () => {
  it('media e conteggio su tutte le recensioni', async () => {
    let lettura: Lettura | null = null;
    globale.__DATI_QUERY__ = (o: Lettura) => { lettura = o; return undefined; };
    const mod = await monta('app/rider/reviews/page.tsx');
    accendi(mod.default as ComponentType).smonta();
    globale.__UTENTE__ = { id: 'rider-1' };
    const righe: Riga[] = Array.from({ length: 1500 }, (_, i) => ({
      id: `r-${String(i).padStart(4, '0')}`,
      // Le prime mille, le piu' recenti, tutte da 5 stelle; le altre 500 da 2.
      rating: i < 1000 ? 5 : 2,
      comment: null,
      created_at: new Date(Date.UTC(2026, 10, 1) - i * 60_000).toISOString(),
      autore_nome: 'Anna',
    }));
    globale.__CLIENT_SUPABASE__ = creaPostgrestColTetto({ rider_reviews_ricevute: righe }).client;
    const dati = await (lettura as unknown as Lettura).queryFn!();
    globale.__DATI_QUERY__ = dati;
    const s = accendi(mod.default as ComponentType);
    const testo = s.radice.textContent ?? '';
    expect(testo, 'Il conteggio si fermava alle prime mille recensioni').toContain('Su 1500 recensioni');
    expect(testo).toContain('4,0');
    s.smonta();
  }, 60000);
});
