/**
 * 30/10/2026 (ondata 21) — LA CASSA PROPONE SOLO LE FASCE CHE LA ROTTA ACCETTEREBBE.
 *
 * Due difetti, una radice: il selettore «Quando vuoi riceverlo» conosceva solo l'ora intera e
 * non gli orari dei negozi del carrello.
 *  ① Giovedì 29/10 alle 14:00 la cassa partiva su «Oggi · 15:00–18:00» per Pane Quotidiano, che
 *    il giovedì chiude alle 13 e non riapre: il no (409) arrivava solo premendo «Ordina».
 *  ② Lunedì 2/11 alle 17:50 segnava «In giornata · 15:00–18:00», cioè «arriva entro dieci minuti».
 *    Scelta di Nicola: una fascia si sceglie fino a 60 minuti prima della sua fine.
 *
 * Le ore sono quelle di Roma: dopo il 25/10/2026 Roma è UTC+1.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeliverySlotPicker, quandoLaVeloceCade } from '@/components/checkout/DeliverySlotPicker';
import { consegnaScelta, giornoDiPartenza, FASCE_DI_OGGI, type Giorno } from '@/lib/quando-arriva';
import { negozioPuoServire, romeNow } from '@/lib/store-hours';

const GIORNATA: [string, string][] = [['09:00', '13:00'], ['16:30', '19:30']];
/** Pane Quotidiano: lun-sab 9-13 e 16:30-19:30, giovedì pomeriggio e domenica chiuso. */
const PANE_QUOTIDIANO = { mon: GIORNATA, tue: GIORNATA, wed: GIORNATA, thu: [['09:00', '13:00']], fri: GIORNATA, sat: GIORNATA };

const GIOVEDI_14 = '2026-10-29T13:00:00Z';
const DOMENICA_10 = '2026-11-01T09:00:00Z';
const LUNEDI_17_00 = '2026-11-02T16:00:00Z';
const LUNEDI_17_01 = '2026-11-02T16:01:00Z';
const LUNEDI_17_50 = '2026-11-02T16:50:00Z';

const POMERIGGIO = 'Oggi · 16:30–18:00';
const STASERA = 'Oggi · 18:00–19:30';

afterEach(() => {
  vi.useRealTimers();
});

function alle(istante: string | number) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(istante));
}

/** La cassa disegnata a quell'ora, con il carrello di Pane Quotidiano. */
function cassa(day: Giorno) {
  const props = {
    day,
    onDayChange: () => {},
    todayTime: '',
    onTodayTimeChange: () => {},
    tomorrowTime: '',
    onTomorrowTimeChange: () => {},
    veloceDisponibile: false,
    prezzoVeloce: '+1 €',
    orariNegozi: [PANE_QUOTIDIANO],
  };
  return renderToStaticMarkup(<DeliverySlotPicker {...props} />);
}

function tessera(html: string, titolo: string): string {
  return html.match(new RegExp(`<button[^>]*aria-label="${titolo},[^"]*"[^>]*>`))?.[0] ?? '';
}

function fasceProposte(html: string): string[] {
  return Array.from(html.matchAll(/name="deliverySlot"[^>]*value="([^"]+)"/g), (m) => m[1]);
}

describe('la tessera «Oggi» guarda gli orari del negozio', () => {
  it('giovedì alle 14:00 «Oggi» è spenta e non propone fasce: il forno non riapre', () => {
    alle(GIOVEDI_14);
    const html = cassa('today');
    expect(tessera(html, 'Oggi')).toContain('disabled');
    expect(fasceProposte(html)).toEqual([]);
  });

  it('giovedì alle 14:00 la cassa parte da domani, sulla prima fascia che il forno serve', () => {
    alle(GIOVEDI_14);
    const adesso = romeNow();
    expect(giornoDiPartenza(adesso, [PANE_QUOTIDIANO])).toBe('tomorrow');
    const caduta = quandoLaVeloceCade({ day: 'now', expressAvailable: false, ora: 14, adesso, orari: [PANE_QUOTIDIANO] });
    expect(caduta?.day).toBe('tomorrow');
    expect(caduta?.fascia).toBe('Domani · 9:00–11:00');
  });

  it('domenica alle 10:00 niente «Oggi»', () => {
    alle(DOMENICA_10);
    const html = cassa('today');
    expect(tessera(html, 'Oggi')).toContain('disabled');
    expect(fasceProposte(html)).toEqual([]);
  });

  it('lunedì alle 10:00 «Oggi» c\'è, ed è da lì che si parte', () => {
    alle('2026-11-02T09:00:00Z');
    expect(tessera(cassa('today'), 'Oggi')).not.toContain('disabled');
    expect(giornoDiPartenza(romeNow(), [PANE_QUOTIDIANO])).toBe('today');
  });
});

describe('una fascia si sceglie fino a 60 minuti prima della sua fine', () => {
  it('lunedì alle 17:50 la 15:00–18:00 non c\'è: la prima proposta è la successiva', () => {
    alle(LUNEDI_17_50);
    expect(fasceProposte(cassa('today'))).toEqual([STASERA, 'Oggi · 19:30–21:00']);
  });

  it('lunedì alle 17:00 la 15:00–18:00 c\'è ancora (mancano 60 minuti)', () => {
    alle(LUNEDI_17_00);
    expect(fasceProposte(cassa('today'))).toContain(POMERIGGIO);
  });

  it('lunedì alle 17:01 non c\'è più, e il freno dell\'ordine la ferma', () => {
    alle(LUNEDI_17_01);
    expect(fasceProposte(cassa('today'))).not.toContain(POMERIGGIO);
    const c = consegnaScelta({
      giorno: 'today',
      ora: 17,
      fasciaOggi: POMERIGGIO,
      fasciaDomani: 'Domani · 9:00–12:00',
      ritiroInNegozio: false,
      adesso: romeNow(),
      orari: [PANE_QUOTIDIANO],
    });
    expect(c.tipo).toBe('non-valida');
  });
});

describe('nessuna fascia proposta dalla cassa viene poi rifiutata dalla rotta, per tutta la settimana', () => {
  it('ogni 5 minuti da lunedì 2/11 a domenica 8/11, oggi e domani', () => {
    // Lunedì 2/11/2026 00:00 a Roma = domenica 1/11 23:00 UTC.
    const inizio = Date.UTC(2026, 10, 1, 23, 0);
    let proposte = 0;
    const rifiutate: string[] = [];
    for (let m = 0; m < 7 * 24 * 60; m += 5) {
      alle(inizio + m * 60_000);
      const adesso = romeNow();
      const minuti = adesso.getHours() * 60 + adesso.getMinutes();
      for (const day of ['today', 'tomorrow'] as const) {
        for (const f of fasceProposte(cassa(day))) {
          proposte++;
          const diOggi = FASCE_DI_OGGI.find((x) => x.etichetta === f);
          const inTempo = !diOggi || diOggi.oraDiFine * 60 - minuti >= 60;
          if (!inTempo || !negozioPuoServire(PANE_QUOTIDIANO, f, adesso)) {
            rifiutate.push(`${adesso.toDateString()} ${adesso.getHours()}:${String(adesso.getMinutes()).padStart(2, '0')} · ${f}`);
          }
        }
      }
    }
    expect(proposte).toBeGreaterThan(1000);
    expect(rifiutate.slice(0, 5)).toEqual([]);
  }, 60_000);
});
