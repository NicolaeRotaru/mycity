/**
 * @vitest-environment jsdom
 *
 * «Finito per oggi» e «chiuso fino al…» promessi ai negozi: il negoziante li preme nell'editor degli
 * orari, e il valore che esce deve fermare gli ordini. Si monta l'editor vero e il valore uscito
 * passa alle stesse regole della cassa. Orologio finto: mercoledì 25/11/2026, 11:00 a Roma.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import StoreHoursEditor from '@/components/seller/StoreHoursEditor';
import { isStoreClosedForOrder, negozioPuoServire, romeNow, type StoreHours } from '@/lib/store-hours';
import { motivoFasciaRifiutata } from '@/lib/quando-arriva';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GIORNO: [string, string][] = [['08:00', '20:00']];
const APERTO_SEMPRE: StoreHours = { mon: GIORNO, tue: GIORNO, wed: GIORNO, thu: GIORNO, fri: GIORNO, sat: GIORNO, sun: GIORNO };
const OGGI = 'Stasera · 18:00–20:00';
const DOMANI = 'Domani · 9:00–11:00';

let root: Root | null = null;
let box: HTMLDivElement | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-25T10:00:00Z'));
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  box?.remove();
  root = null;
  box = null;
  vi.useRealTimers();
});

function apri(iniziale: StoreHours) {
  let ultimo: StoreHours = iniziale;
  function Modulo() {
    const [orari, setOrari] = useState<StoreHours>(iniziale);
    return <StoreHoursEditor value={orari} onChange={(n) => { ultimo = n; setOrari(n); }} />;
  }
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => root!.render(<Modulo />));
  return {
    ultimo: () => ultimo,
    finitoPerOggi: () => {
      const b = [...box!.querySelectorAll('button')].find((x) => x.textContent === 'Finito per oggi');
      expect(b, 'pulsante «Finito per oggi» non trovato').toBeTruthy();
      act(() => b!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    },
    chiusoFinoAl: (giorno: string) => {
      const i = box!.querySelector('input[type="date"]') as HTMLInputElement | null;
      expect(i, 'campo «Chiuso fino al» non trovato').toBeTruthy();
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(i, giorno);
        i!.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
  };
}

describe('«Finito per oggi»', () => {
  it('oggi si rifiuta, la fascia di domani resta servibile', () => {
    const e = apri(APERTO_SEMPRE);
    expect(negozioPuoServire(e.ultimo(), OGGI)).toBe(true);
    e.finitoPerOggi();
    const v = e.ultimo();
    expect(isStoreClosedForOrder(v)).toBe(true);
    expect(negozioPuoServire(v, OGGI)).toBe(false);
    expect(negozioPuoServire(v, DOMANI)).toBe(true);
    expect(motivoFasciaRifiutata(OGGI, [{ nome: 'Forno', orari: v }])).toContain('finito per oggi');
  });

  it('vale anche per un negozio senza orari impostati', () => {
    const e = apri({});
    e.finitoPerOggi();
    expect(negozioPuoServire(e.ultimo(), OGGI)).toBe(false);
    expect(negozioPuoServire(e.ultimo(), DOMANI)).toBe(true);
  });

  it('scade da solo a mezzanotte', () => {
    const e = apri(APERTO_SEMPRE);
    e.finitoPerOggi();
    vi.setSystemTime(new Date('2026-11-26T10:00:00Z'));
    expect(isStoreClosedForOrder(e.ultimo(), romeNow())).toBe(false);
    expect(negozioPuoServire(e.ultimo(), OGGI)).toBe(true);
  });
});

describe('«Chiuso fino al»', () => {
  it('dopodomani rifiuta oggi e domani, e poi riapre', () => {
    const e = apri(APERTO_SEMPRE);
    e.chiusoFinoAl('2026-11-27');
    const v = e.ultimo();
    expect(v.chiusoFinoAl).toBe('2026-11-27');
    expect(isStoreClosedForOrder(v)).toBe(true);
    expect(negozioPuoServire(v, OGGI)).toBe(false);
    expect(negozioPuoServire(v, DOMANI)).toBe(false);
    expect(motivoFasciaRifiutata(DOMANI, [{ nome: 'Forno', orari: v }])).toContain('chiuso fino al 27/11');
    vi.setSystemTime(new Date('2026-11-27T10:00:00Z')); // giovedì: domani è venerdì 28
    expect(negozioPuoServire(v, DOMANI)).toBe(true);
  });

  it('il campo vuoto toglie la chiave', () => {
    const e = apri({ ...APERTO_SEMPRE, chiusoFinoAl: '2026-11-27' });
    e.chiusoFinoAl('');
    expect('chiusoFinoAl' in e.ultimo()).toBe(false);
    expect(negozioPuoServire(e.ultimo(), OGGI)).toBe(true);
  });
});
