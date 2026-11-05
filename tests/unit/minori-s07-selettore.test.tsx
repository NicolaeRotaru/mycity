/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { DeliverySlotPicker, dataBreve, quandoLaVeloceCade } from '@/components/checkout/DeliverySlotPicker';
import { FASCE_DI_DOMANI, fasceAncoraPossibili } from '@/lib/quando-arriva';
import { accendi } from './aiuti/schermo';

const giorno = [['09:00', '13:00'], ['16:30', '19:30']];
const PANE = { mon: giorno, tue: giorno, wed: giorno, thu: [['09:00', '13:00']], fri: giorno, sat: giorno, sun: [] };

describe('S07 · quando la veloce cade', () => {
  it('di giorno (Roma 14:00) resta Oggi e l’avviso nomina la fascia di oggi che resta segnata', () => {
    const adesso = new Date(2026, 10, 2, 14, 0);
    const possibili = fasceAncoraPossibili(adesso, [PANE]);
    expect(possibili.length).toBeGreaterThan(1);
    const c = quandoLaVeloceCade({ day: 'now', expressAvailable: false, ora: 14, adesso, orari: [PANE], sceltaOggi: possibili[1] });
    expect(c?.day).toBe('today');
    expect(c?.fascia).toBe(possibili[1]);
    expect(c?.avviso).toContain(possibili[1]);
  });
  it('la sera resta la fascia di domani già scelta, non la prima del mattino', () => {
    const adesso = new Date(2026, 10, 2, 20, 30);
    const c = quandoLaVeloceCade({ day: 'now', expressAvailable: false, ora: 20, adesso, orari: [PANE], sceltaDomani: FASCE_DI_DOMANI[4] });
    expect(c?.day).toBe('tomorrow');
    expect(c?.fascia).toBe(FASCE_DI_DOMANI[4]);
  });
});

describe('S07 · «Oggi» e «Domani» col giorno e la data', () => {
  it('martedì 10/11 alle 00:40: Oggi è mar 10/11, Domani è mer 11/11', () => {
    expect(dataBreve(new Date(2026, 10, 10, 0, 40))).toBe('mar 10/11');
    expect(dataBreve(new Date(2026, 10, 11))).toBe('mer 11/11');
  });
  it('a cavallo del mese: sabato 31/10 → domenica 1/11', () => {
    expect(dataBreve(new Date(2026, 9, 31 + 1))).toBe('dom 1/11');
  });
});

function Selettore(p: { veloce: boolean | null; motivo?: string | null; giorno?: 'now' | 'today' | 'tomorrow' }) {
  const [day, setDay] = useState<'now' | 'today' | 'tomorrow'>(p.giorno ?? 'tomorrow');
  const [oggi, setOggi] = useState('');
  const [domani, setDomani] = useState(FASCE_DI_DOMANI[3]);
  return (
    <DeliverySlotPicker
      day={day} onDayChange={setDay} todayTime={oggi} onTodayTimeChange={setOggi}
      tomorrowTime={domani} onTomorrowTimeChange={setDomani}
      veloceDisponibile={p.veloce} prezzoVeloce="+1 €" motivoVeloce={p.motivo ?? null} orariNegozi={[]}
    />
  );
}

describe('S07 · il selettore montato', () => {
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

  it('le tessere dicono il giorno della settimana e la data', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T23:40:00Z')); // martedì 10/11 alle 00:40 a Roma
    const s = accendi(Selettore, { veloce: false });
    const tessere = [...s.radice.querySelectorAll('button[aria-pressed]')].map((b) => b.getAttribute('aria-label'));
    expect(tessere.some((t) => t?.startsWith('Oggi, mar 10/11'))).toBe(true);
    expect(tessere.some((t) => t?.startsWith('Domani, mer 11/11'))).toBe(true);
    s.smonta();
  });

  it('mentre aspetta la risposta non mostra il motivo del no di prima', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T13:00:00Z')); // lunedì 14:00 a Roma
    const s = accendi(Selettore, { veloce: null, motivo: 'Nessun fattorino è in servizio adesso.', giorno: 'now' });
    expect(s.radice.textContent).toContain('Sto controllando');
    expect(s.radice.textContent).not.toContain('Nessun fattorino è in servizio adesso.');
    s.smonta();
  });
});

const comando = { setVeloce: (_v: boolean | null) => {} };
function SelettoreComandato() {
  const [veloce, setVeloce] = useState<boolean | null>(null);
  comando.setVeloce = setVeloce;
  const [day, setDay] = useState<'now' | 'today' | 'tomorrow'>('now');
  const [oggi, setOggi] = useState('');
  const [domani, setDomani] = useState(FASCE_DI_DOMANI[3]);
  return (
    <DeliverySlotPicker
      day={day} onDayChange={setDay} todayTime={oggi} onTodayTimeChange={setOggi}
      tomorrowTime={domani} onTomorrowTimeChange={setDomani}
      veloceDisponibile={veloce} prezzoVeloce="+1 €" orariNegozi={[]}
    />
  );
}

describe('S07 · l’avviso della veloce caduta', () => {
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });
  it('sparisce quando al controllo dopo «Adesso» torna disponibile', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T13:00:00Z')); // lunedì 14:00 a Roma
    const s = accendi(SelettoreComandato, {});
    s.agisci(() => comando.setVeloce(false));
    expect(s.radice.textContent).toMatch(/La consegna veloce adesso non si può più/);
    s.agisci(() => comando.setVeloce(true));
    expect(s.radice.textContent).not.toMatch(/La consegna veloce adesso non si può più/);
    s.smonta();
  });
});
