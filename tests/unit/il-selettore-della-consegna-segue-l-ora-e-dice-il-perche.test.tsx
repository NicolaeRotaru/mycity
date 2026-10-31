/**
 * @vitest-environment jsdom
 *
 * 31/10/2026 — IL SELETTORE «QUANDO VUOI RICEVERLO» SEGUE L'ORA E DICE IL PERCHÉ.
 *
 * ① Aperto lunedì alle 16:55, alle 17:05 offriva ancora «Oggi · 16:30–18:00»: l'ora si leggeva
 *    solo al disegno. La cassa poi fermava l'ordine.
 * ② Sabato alle 19:30 da Pane Quotidiano (la domenica è chiusa) la veloce cade e l'avviso diceva
 *    «ho messo «Domani · …»», una fascia che il negozio non serve, sotto la tessera «Negozio chiuso».
 * ③ Giovedì alle 13:05 la veloce cade perché il forno è chiuso: il perché del server spariva
 *    proprio mentre compariva l'avviso dello spostamento.
 *
 * Le ore sono quelle di Roma: dopo il 25/10/2026 Roma è UTC+1.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DeliverySlotPicker, quandoLaVeloceCade } from '@/components/checkout/DeliverySlotPicker';
import { fasceAncoraPossibili, fasceDiDomaniPossibili, type Giorno } from '@/lib/quando-arriva';
import { romeNow } from '@/lib/store-hours';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GIORNATA: [string, string][] = [['09:00', '13:00'], ['16:30', '19:30']];
/** Pane Quotidiano: lun-sab 9-13 e 16:30-19:30, giovedì pomeriggio e domenica chiuso. */
const PANE_QUOTIDIANO = { mon: GIORNATA, tue: GIORNATA, wed: GIORNATA, thu: [['09:00', '13:00']], fri: GIORNATA, sat: GIORNATA };
const MOTIVO = 'Pane Quotidiano adesso è chiuso: la consegna veloce non si può.';

const LUNEDI_16_55 = '2026-11-02T15:55:00Z';
const SABATO_19_30 = '2026-10-31T18:30:00Z';
const GIOVEDI_13_05 = '2026-10-29T12:05:00Z';

let root: Root | null = null;
let box: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  box?.remove();
  root = null;
  box = null;
  vi.useRealTimers();
});

function alle(istante: string) {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(istante));
}

function cassa(p: { giorno: Giorno; veloce: boolean | null; motivo?: string | null; orari?: unknown[] }) {
  function Cassa() {
    const [day, setDay] = useState<Giorno>(p.giorno);
    const [todayTime, setTodayTime] = useState('Oggi · 16:30–18:00');
    const [tomorrowTime, setTomorrowTime] = useState('Domani · 11:00–13:00');
    return (
      <DeliverySlotPicker
        day={day} onDayChange={setDay}
        todayTime={todayTime} onTodayTimeChange={setTodayTime}
        tomorrowTime={tomorrowTime} onTomorrowTimeChange={setTomorrowTime}
        veloceDisponibile={p.veloce} prezzoVeloce="+1 €" motivoVeloce={p.motivo ?? null}
        orariNegozi={p.orari ?? []}
      />
    );
  }
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => root!.render(<Cassa />));
  return box;
}

const fasce = (b: HTMLElement) => [...b.querySelectorAll<HTMLInputElement>('input[type=radio]')].map((r) => r.value);
const scelta = (b: HTMLElement) => b.querySelector<HTMLInputElement>('input[type=radio]:checked')?.value;

describe('① il selettore rilegge l\'ora da solo', () => {
  it('aperto alle 16:55, alle 17:05 non offre più «Oggi · 16:30–18:00» e sposta la scelta', () => {
    alle(LUNEDI_16_55);
    const b = cassa({ giorno: 'today', veloce: false });
    expect(fasce(b)).toContain('Oggi · 16:30–18:00');
    expect(scelta(b)).toBe('Oggi · 16:30–18:00');

    act(() => { vi.advanceTimersByTime(10 * 60_000); });

    expect(fasce(b)).not.toContain('Oggi · 16:30–18:00');
    expect(scelta(b)).toBe('Oggi · 18:00–19:30');
  });
});

describe('② sabato sera, con la domenica chiusa, l\'avviso non nomina una fascia finta', () => {
  it('il caso è reale: né oggi né domani resta una fascia', () => {
    alle(SABATO_19_30);
    const adesso = romeNow();
    expect(fasceAncoraPossibili(adesso, [PANE_QUOTIDIANO])).toEqual([]);
    expect(fasceDiDomaniPossibili(adesso, [PANE_QUOTIDIANO])).toEqual([]);
  });

  it('la regola non mette nessuna fascia e dice che per ora non si può', () => {
    alle(SABATO_19_30);
    const caduta = quandoLaVeloceCade({ day: 'now', expressAvailable: false, ora: 19, adesso: romeNow(), orari: [PANE_QUOTIDIANO] });
    expect(caduta).not.toBeNull();
    expect(caduta?.fascia).toBeNull();
    expect(caduta?.avviso).not.toMatch(/ho messo/);
    expect(caduta?.avviso).toMatch(/non si può/);
  });

  it('sullo schermo l\'avviso non contraddice la tessera «Negozio chiuso»', () => {
    alle(SABATO_19_30);
    const b = cassa({ giorno: 'now', veloce: false, orari: [PANE_QUOTIDIANO] });
    const avviso = b.querySelector('[role=status]')?.textContent ?? '';
    expect(avviso).toMatch(/non si può più/);
    expect(avviso).not.toMatch(/ho messo/);
    expect(b.textContent).toContain('Negozio chiuso');
  });
});

describe('③ quando la veloce cade perché il negozio è chiuso, il perché resta', () => {
  it('giovedì alle 13:05 si vedono l\'avviso dello spostamento E il motivo del server', () => {
    alle(GIOVEDI_13_05);
    const b = cassa({ giorno: 'now', veloce: false, motivo: MOTIVO, orari: [PANE_QUOTIDIANO] });
    expect(b.querySelector('[role=status]')?.textContent ?? '').toMatch(/non si può più/);
    expect(b.textContent).toContain(MOTIVO);
  });
});
