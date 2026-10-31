/**
 * 30/10/2026 (ondata 22) — LE SETTE FASCE DI NICOLA E LA REGOLA DEL RITIRO, UNA REGOLA SOLA.
 *
 * Le fasce di prima (oggi 15-18 e 18-20, domani 9-12, 12-15, 15-18:30, 18:30-20) cadevano nella
 * pausa dei negozi di Piacenza. Nicola ha scelto sette fasce uguali per oggi e domani e la regola
 * del ritiro: una fascia si serve se il negozio è aperto in un momento fra l'ordine e 60 minuti
 * prima della fine della fascia (MyCity tiene la merce da parte). La stessa regola la chiedono il
 * selettore, la vetrina, la bozza della cassa e il freno della veloce, con la Date intera.
 *
 * Pane Quotidiano: lun-sab 9-13 e 16:30-19:30, giovedì pomeriggio e domenica chiuso. Le Date sono
 * l'orologio di Roma (lunedì 2/11/2026 … domenica 8/11/2026).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeliverySlotPicker } from '@/components/checkout/DeliverySlotPicker';
import {
  FASCE_DI_DOMANI,
  FASCE_DI_OGGI,
  fasceAncoraPossibili,
  fasceDiDomaniPossibili,
  fasciaFuoriTempo,
  giornoDiPartenza,
} from '@/lib/quando-arriva';
import { negozioPuoServire } from '@/lib/store-hours';
import { consegnaDellaVetrina } from '@/lib/promessa-consegna';
import { fasciaDaRimettere, giornoDaRimettere } from '@/lib/bozza-checkout';

const GIORNATA: [string, string][] = [['09:00', '13:00'], ['16:30', '19:30']];
const PQ = { mon: GIORNATA, tue: GIORNATA, wed: GIORNATA, thu: [['09:00', '13:00']], fri: GIORNATA, sat: GIORNATA };

const lunedi = (h: number, m = 0) => new Date(2026, 10, 2, h, m);
const giovedi = (h: number, m = 0) => new Date(2026, 10, 5, h, m);
const venerdi = (h: number, m = 0) => new Date(2026, 10, 6, h, m);
const sabato = (h: number, m = 0) => new Date(2026, 10, 7, h, m);
const oggi = (d: Date) => fasceAncoraPossibili(d, [PQ]);

afterEach(() => vi.useRealTimers());

describe('le sette fasce scelte da Nicola', () => {
  it('sono sette, uguali per oggi e per domani, e le vecchie non si propongono più', () => {
    const orari = ['7:30–9:00', '9:00–11:00', '11:00–13:00', '13:00–16:30', '16:30–18:00', '18:00–19:30', '19:30–21:00'];
    expect(FASCE_DI_OGGI.map((f) => f.etichetta)).toEqual(orari.map((o) => `Oggi · ${o}`));
    expect(FASCE_DI_DOMANI).toEqual(orari.map((o) => `Domani · ${o}`));
  });
});

describe('i casi di Pane Quotidiano', () => {
  it('1. lunedì alle 12:00 la 13:00–16:30 si sceglie: si ritira entro le 13', () => {
    expect(oggi(lunedi(12))).toContain('Oggi · 13:00–16:30');
    expect(negozioPuoServire(PQ, 'Oggi · 13:00–16:30', lunedi(12))).toBe(true);
  });
  it('2. lunedì alle 14:00 la 13:00–16:30 no: il forno riapre alle 16:30, troppo tardi', () => {
    expect(oggi(lunedi(14))).not.toContain('Oggi · 13:00–16:30');
    expect(negozioPuoServire(PQ, 'Oggi · 13:00–16:30', lunedi(14))).toBe(false);
  });
  it('3. lunedì alle 14:00 la 19:30–21:00 sì: aperto 16:30-19:30, prima delle 20:00', () => {
    expect(oggi(lunedi(14))).toContain('Oggi · 19:30–21:00');
  });
  it('4. lunedì alle 17:00 la 16:30–18:00 c’è, alle 17:01 no (mancano 59 minuti)', () => {
    expect(oggi(lunedi(17, 0))).toContain('Oggi · 16:30–18:00');
    expect(oggi(lunedi(17, 1))).not.toContain('Oggi · 16:30–18:00');
  });
  it('5. giovedì alle 14:00 per oggi niente: la cassa parte da domani', () => {
    expect(oggi(giovedi(14))).toEqual([]);
    expect(giornoDiPartenza(giovedi(14), [PQ])).toBe('tomorrow');
    expect(fasceDiDomaniPossibili(giovedi(14), [PQ])[0]).toBe('Domani · 9:00–11:00');
  });
  it('6. venerdì alle 8:00 la 7:30–9:00 no (il forno apre alle 9), la 9:00–11:00 sì', () => {
    expect(oggi(venerdi(8))).not.toContain('Oggi · 7:30–9:00');
    expect(oggi(venerdi(8))).toContain('Oggi · 9:00–11:00');
  });
  it('7. lunedì alle 19:15 la vetrina dice «oggi» e la cassa ha la 19:30–21:00', () => {
    expect(oggi(lunedi(19, 15))).toEqual(['Oggi · 19:30–21:00']);
    expect(consegnaDellaVetrina({ orari: PQ, adesso: lunedi(19, 15), veloce: false })).toBe('oggi');
  });
});

describe('8. una settimana, minuto per minuto', () => {
  it('la vetrina dice «oggi» solo quando la cassa ha una fascia di oggi, e le rotte accettano ogni fascia proposta', () => {
    const storti: string[] = [];
    const rifiutate: string[] = [];
    let proposte = 0;
    for (let m = 0; m < 7 * 24 * 60; m++) {
      const d = new Date(2026, 10, 2, 0, m);
      const cassaOggi = oggi(d);
      const vetrina = consegnaDellaVetrina({ orari: PQ, adesso: d, veloce: false });
      if ((vetrina === 'oggi') !== cassaOggi.length > 0) storti.push(`${d.toString()} vetrina=${vetrina}`);
      for (const f of [...cassaOggi, ...fasceDiDomaniPossibili(d, [PQ])]) {
        proposte++;
        // Le due rotte: prima i 60 minuti, poi la regola del ritiro sugli orari del negozio.
        if (fasciaFuoriTempo(f, d) !== null || !negozioPuoServire(PQ, f, d)) rifiutate.push(`${d.toString()} · ${f}`);
      }
    }
    expect(proposte).toBeGreaterThan(10_000);
    expect(storti.slice(0, 5)).toEqual([]);
    expect(rifiutate.slice(0, 5)).toEqual([]);
  });
});

describe('la bozza della cassa chiede alla stessa regola, coi minuti e gli orari', () => {
  it('lunedì alle 19:15 rimette la 19:30–21:00 ma non la 18:00–19:30 (15 minuti)', () => {
    expect(fasciaDaRimettere('today', 'Oggi · 19:30–21:00', lunedi(19, 15), [PQ])).toBe('Oggi · 19:30–21:00');
    expect(fasciaDaRimettere('today', 'Oggi · 18:00–19:30', lunedi(19, 15), [PQ])).toBeNull();
  });
  it('giovedì alle 14:00 «oggi» non si rimette: il forno non riapre', () => {
    expect(giornoDaRimettere('today', giovedi(14), [PQ])).toBeNull();
  });
});

describe('il freno della veloce sposta solo su fasce che la cassa propone', () => {
  it('lunedì alle 17:50 la prima è la 18:00–19:30; sabato alle 20:20, domenica chiusa, nessuna', async () => {
    const { fasciaDopoLaVeloce } = await import('@/lib/ordini/veloce-non-confermata');
    expect(fasciaDopoLaVeloce(lunedi(17, 50), [PQ])).toBe('Oggi · 18:00–19:30');
    expect(fasciaDopoLaVeloce(sabato(20, 20), [PQ])).toBeNull();
  });
});

describe('la tessera «Oggi» dice il motivo vero', () => {
  function tesseraOggi(istante: string): string {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(istante));
    const html = renderToStaticMarkup(
      <DeliverySlotPicker
        day="tomorrow"
        onDayChange={() => {}}
        todayTime=""
        onTodayTimeChange={() => {}}
        tomorrowTime=""
        onTomorrowTimeChange={() => {}}
        veloceDisponibile={false}
        prezzoVeloce="+1 €"
        orariNegozi={[PQ]}
      />,
    );
    return html.match(/<button[^>]*aria-label="Oggi,[^"]*"[^>]*>/)?.[0] ?? '';
  }
  it('domenica alle 10 «Negozio chiuso», non «Non più oggi»', () => {
    expect(tesseraOggi('2026-11-01T09:00:00Z')).toContain('Negozio chiuso');
  });
  it('lunedì alle 20:30 «Non più oggi»', () => {
    expect(tesseraOggi('2026-11-02T19:30:00Z')).toContain('Non più oggi');
  });
});
