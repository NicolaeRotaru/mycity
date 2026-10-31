/**
 * @vitest-environment jsdom
 *
 * 31/10/2026 — CHIUSO PER FERIE VUOL DIRE CHIUSO, E IL RITIRO SPENTO NON SI OFFRE.
 *
 * ① Il sito non ha un pulsante «ferie»: il negoziante preme «Chiudi» su ogni giorno degli orari.
 *    Pane Quotidiano ha gli orari da lunedì a sabato (la domenica non c'è). Chiusi tutti, il sito
 *    li leggeva «orari mai impostati» e accettava ordini a qualunque ora.
 * ② Il ritiro in negozio è spento, ma il no della cassa diceva «oppure ritira in negozio» e il
 *    negoziante poteva esporre il bollino «Ritiro in negozio» sulla sua pagina.
 *
 * Le ore sono quelle di Roma: dopo il 25/10/2026 Roma è UTC+1.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import StoreHoursEditor from '@/components/seller/StoreHoursEditor';
import { isStoreClosedForOrder, motivoNegozioChiuso, negozioPuoServire, type StoreHours } from '@/lib/store-hours';
import { motivoFasciaRifiutata } from '@/lib/quando-arriva';
import { BADGE_CATALOG, normalizeCustomization } from '@/lib/store-customization';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GIORNATA: [string, string][] = [['09:00', '13:00'], ['16:30', '19:30']];
/** Pane Quotidiano: lun-sab 9-13 e 16:30-19:30, giovedì pomeriggio chiuso, la domenica non scritta. */
const PANE_QUOTIDIANO: StoreHours = {
  mon: GIORNATA, tue: GIORNATA, wed: GIORNATA, thu: [['09:00', '13:00']], fri: GIORNATA, sat: GIORNATA,
};
const SETTIMANA_CHIUSA: StoreHours = { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };

/** Martedì 3/11/2026 alle 10:00 a Roma (lo legge `romeNow`: qui si passa già «di Roma»). */
const MARTEDI_10 = new Date('2026-11-03T10:00:00');
const POMERIGGIO = 'Oggi · 16:30–18:00';
const DOMANI = 'Domani · 9:00–11:00';

let root: Root | null = null;
let box: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  box?.remove();
  root = null;
  box = null;
});

/** L'editor degli orari come lo usa il modulo del negozio, con lo stato vero. */
function chiudiTuttiIGiorni(iniziale: StoreHours): StoreHours {
  let ultimo: StoreHours = iniziale;
  function Modulo() {
    const [orari, setOrari] = useState<StoreHours>(iniziale);
    return <StoreHoursEditor value={orari} onChange={(n) => { ultimo = n; setOrari(n); }} />;
  }
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => root!.render(<Modulo />));
  for (let giro = 0; giro < 10; giro++) {
    const chiudi = [...box.querySelectorAll('button')].find((b) => b.textContent === 'Chiudi');
    if (!chiudi) break;
    act(() => chiudi.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  }
  return ultimo;
}

describe('chiuso per ferie: «Chiudi» su ogni giorno ferma gli ordini', () => {
  it('prima di chiudere, martedì alle 10 Pane Quotidiano serve il pomeriggio (il caso è reale)', () => {
    expect(negozioPuoServire(PANE_QUOTIDIANO, POMERIGGIO, MARTEDI_10)).toBe(true);
    expect(isStoreClosedForOrder(PANE_QUOTIDIANO, MARTEDI_10)).toBe(false);
  });

  it('IL CASO: chiusi tutti i giorni dall\'editor, non passa nessun ordine', () => {
    const ferie = chiudiTuttiIGiorni(PANE_QUOTIDIANO);
    expect(negozioPuoServire(ferie, POMERIGGIO, MARTEDI_10)).toBe(false);
    expect(negozioPuoServire(ferie, DOMANI, MARTEDI_10)).toBe(false);
    expect(negozioPuoServire(ferie, null, MARTEDI_10)).toBe(false);
    expect(isStoreClosedForOrder(ferie, MARTEDI_10)).toBe(true);
  });

  it('la settimana scritta tutta chiusa è «chiuso», non «non lo so»', () => {
    expect(negozioPuoServire(SETTIMANA_CHIUSA, DOMANI, MARTEDI_10)).toBe(false);
    expect(isStoreClosedForOrder(SETTIMANA_CHIUSA, MARTEDI_10)).toBe(true);
    // La rotta (contanti e carta) dice di no, col nome del negozio.
    const no = motivoFasciaRifiutata(DOMANI, [{ nome: 'Pane Quotidiano', orari: SETTIMANA_CHIUSA }], MARTEDI_10);
    expect(no).toMatch(/Pane Quotidiano/);
  });

  it('orari mai impostati restano «nessun blocco», come prima', () => {
    expect(negozioPuoServire(null, DOMANI, MARTEDI_10)).toBe(true);
    expect(negozioPuoServire({}, DOMANI, MARTEDI_10)).toBe(true);
    expect(negozioPuoServire({ tue: [] }, POMERIGGIO, MARTEDI_10)).toBe(true);
  });
});

describe('il ritiro in negozio è spento: non si consiglia e non si espone', () => {
  it('il no della cassa non dice «oppure ritira in negozio»', () => {
    const domani = motivoNegozioChiuso('Pane Quotidiano', DOMANI, MARTEDI_10);
    const oggi = motivoNegozioChiuso('Pane Quotidiano', POMERIGGIO, MARTEDI_10);
    expect(domani).toMatch(/Scegli un altro orario/);
    expect(oggi).toMatch(/Scegli un altro orario/);
    expect(domani).not.toMatch(/ritir/i);
    expect(oggi).not.toMatch(/ritir/i);
    const rotta = motivoFasciaRifiutata(DOMANI, [{ nome: 'Pane Quotidiano', orari: SETTIMANA_CHIUSA }], MARTEDI_10);
    expect(rotta).not.toMatch(/ritir/i);
  });

  it('il bollino «Ritiro in negozio» non si può scegliere', () => {
    expect(BADGE_CATALOG.map((b) => b.key)).not.toContain('ritiro_in_negozio');
    expect(BADGE_CATALOG.map((b) => b.key)).toContain('bio');
  });

  it('un bollino già salvato non arriva alla pagina, e gli altri restano', () => {
    const c = normalizeCustomization({ badges: ['ritiro_in_negozio', 'bio'] });
    expect(c.badges).toEqual(['bio']);
  });
});
