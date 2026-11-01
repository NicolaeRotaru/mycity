/**
 * @vitest-environment jsdom
 *
 * 01/11/2026 — LA FASCIA SCELTA IN CASSA NON CAMBIA IN SILENZIO.
 *
 * Il selettore rilegge l'ora ogni 30 secondi e, quando la fascia scelta non si può più, la sposta
 * alla prima ancora possibile. Lo spostamento era muto: lunedì alle 16:55 il cliente sceglie
 * «Oggi · 16:30–18:00», va a prendere il portafoglio, alle 17:05 la cassa ha «Oggi · 18:00–19:30»
 * e nessuna riga lo dice. L'avviso c'era solo per la veloce che cade.
 *
 * Le ore sono quelle di Roma: dopo il 25/10/2026 Roma è UTC+1.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DeliverySlotPicker } from '@/components/checkout/DeliverySlotPicker';
import type { Giorno } from '@/lib/quando-arriva';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LUNEDI_16_55 = '2026-11-02T15:55:00Z';
const LUNEDI_19_55 = '2026-11-02T18:55:00Z';

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

function cassa(p: { oggi: string; domani?: string }) {
  function Cassa() {
    const [day, setDay] = useState<Giorno>('today');
    const [todayTime, setTodayTime] = useState(p.oggi);
    const [tomorrowTime, setTomorrowTime] = useState(p.domani ?? 'Domani · 11:00–13:00');
    return (
      <DeliverySlotPicker
        day={day} onDayChange={setDay}
        todayTime={todayTime} onTodayTimeChange={setTodayTime}
        tomorrowTime={tomorrowTime} onTomorrowTimeChange={setTomorrowTime}
        veloceDisponibile={false} prezzoVeloce="+1 €"
      />
    );
  }
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => root!.render(<Cassa />));
  return box;
}

const stato = (b: HTMLElement) => [...b.querySelectorAll('[role=status]')].map((e) => e.textContent ?? '').join(' ');
const scelta = (b: HTMLElement) => b.querySelector<HTMLInputElement>('input[type=radio]:checked')?.value;
const premuta = (b: HTMLElement) =>
  [...b.querySelectorAll<HTMLButtonElement>('button[aria-pressed=true]')].map((e) => e.getAttribute('aria-label') ?? '').join(' ');

describe('la fascia di oggi che scade', () => {
  it('lunedì 16:55 «16:30–18:00», dopo 10 minuti: la scelta si sposta e una riga lo dice nominando le due fasce', () => {
    alle(LUNEDI_16_55);
    const b = cassa({ oggi: 'Oggi · 16:30–18:00' });
    expect(scelta(b)).toBe('Oggi · 16:30–18:00');
    expect(stato(b)).toBe('');

    act(() => { vi.advanceTimersByTime(10 * 60_000); });

    expect(scelta(b)).toBe('Oggi · 18:00–19:30');
    expect(stato(b)).toContain('16:30–18:00');
    expect(stato(b)).toContain('18:00–19:30');
  });

  it('il cliente sceglie un\'altra fascia: la riga sparisce', () => {
    alle(LUNEDI_16_55);
    const b = cassa({ oggi: 'Oggi · 16:30–18:00' });
    act(() => { vi.advanceTimersByTime(10 * 60_000); });
    expect(stato(b)).not.toBe('');

    const ultima = b.querySelector<HTMLInputElement>('input[value="Oggi · 19:30–21:00"]')!;
    act(() => { ultima.click(); });

    expect(scelta(b)).toBe('Oggi · 19:30–21:00');
    expect(stato(b)).toBe('');
  });

  it('per oggi non resta niente: si passa a domani e la riga lo dice', () => {
    alle(LUNEDI_19_55);
    const b = cassa({ oggi: 'Oggi · 19:30–21:00' });
    expect(scelta(b)).toBe('Oggi · 19:30–21:00');

    act(() => { vi.advanceTimersByTime(10 * 60_000); });

    expect(premuta(b)).toMatch(/^Domani/);
    expect(stato(b)).toContain('19:30–21:00');
    expect(stato(b)).toMatch(/domani/i);
  });

  it('all\'apertura una fascia di partenza già passata si corregge senza avviso: il cliente non l\'aveva scelta', () => {
    alle(LUNEDI_16_55);
    const b = cassa({ oggi: 'Oggi · 9:00–11:00' });
    expect(scelta(b)).toBe('Oggi · 16:30–18:00');
    expect(stato(b)).toBe('');
  });

  it('se il tempo passa ma la fascia scelta vale ancora, nessuna riga', () => {
    alle(LUNEDI_16_55);
    const b = cassa({ oggi: 'Oggi · 18:00–19:30' });
    act(() => { vi.advanceTimersByTime(10 * 60_000); });
    expect(scelta(b)).toBe('Oggi · 18:00–19:30');
    expect(stato(b)).toBe('');
  });
});
