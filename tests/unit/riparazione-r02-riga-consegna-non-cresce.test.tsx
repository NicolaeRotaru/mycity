// @vitest-environment jsdom
/**
 * R02-009 — Sul telefono il riquadro verde della scheda prodotto «dopo il caricamento cresce ancora di
 * una riga».
 *
 * La prima metà della voce (la tariffa intera da 264 caratteri nel riquadro) è chiusa sulla base da
 * R08-002: la riga del costo è corta, e la prova è tests/unit/riparazione-r08-riquadro-consegna-corto.
 * Restava la prima riga, quella di DeliveryCutoff in linea: prima del caricamento dice «Consegna a casa,
 * all'ora che scegli»; dopo, col negozio chiuso, «Il negozio è chiuso ora, riapre domani alle 08:00: in
 * cassa scegli l'ora della consegna». La riga teneva lo spazio di due righe, e quella frase ne vuole tre
 * nella colonna di un telefono: il riquadro si allungava mentre si leggeva.
 *
 * Qui: tutte le frasi che la regola della scheda (`rigaConsegnaDellaScheda`, non toccata) può scrivere,
 * misurate con la stessa stima della prova della barra a 360 pixel (0,58 em per carattere, a capo per
 * parole), contro lo spazio che il componente VERO riserva nelle colonne più strette del sito. E il
 * componente vero montato col negozio chiuso, sull'orologio finto.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { accendi } from './aiuti/schermo';
import { DeliveryCutoff } from '@/components/ui/DeliveryCutoff';
import { rigaConsegnaDellaScheda } from '@/lib/promessa-consegna';

/** text-sm: 14 px di corpo, 1,25rem di riga. */
const CORPO = 14;
const RIGA_REM = 1.25;
const PER_CARATTERE = 0.58;

/**
 * Quanto è larga la frase nelle colonne più strette della scheda (pixel di testo, tolti i margini del
 * contenitore, il riquadro verde px-3.5 col bordo, la bicicletta da 15 e il gap-1.5):
 *  - telefono da 360: 360 − 2×16 − 2×14 − 2 − 15 − 6 ≈ 279;
 *  - 1023 (md, due colonne in 768): (720 − 24) / 2 − 30 − 21 ≈ 297;
 *  - 1024 (lg, tre colonne: 1fr 1fr 320px in 976): (976 − 320 − 48) / 2 − 30 − 21 ≈ 253, la più stretta;
 *  - 1280 (xl): (1232 − 320 − 48) / 2 − 30 − 21 ≈ 381.
 */
const COLONNE = [
  { schermo: 360, testo: 279 },
  { schermo: 1023, testo: 297 },
  { schermo: 1024, testo: 253 },
  { schermo: 1280, testo: 381 },
];

/** Quante righe chiede una frase in quella larghezza, andando a capo fra le parole. */
function righeChieste(frase: string, larghezza: number): number {
  const c = CORPO * PER_CARATTERE;
  let righe = 1;
  let riga = 0;
  for (const parola of frase.split(' ')) {
    const w = parola.length * c;
    const spazio = riga ? c : 0;
    if (riga + spazio + w <= larghezza) riga += spazio + w;
    else { righe += 1; riga = w; }
  }
  return righe;
}

/** Le righe che la riga in linea tiene da subito, a quella larghezza, lette dalle sue classi. */
function righeRiservate(classi: string, schermo: number): number {
  const base = Number(classi.match(/(?:^|\s)min-h-\[([\d.]+)rem\]/)?.[1] ?? 0);
  const sottoXl = classi.match(/(?:^|\s)max-xl:min-h-\[([\d.]+)rem\]/)?.[1];
  const rem = schermo < 1280 && sottoXl ? Number(sottoXl) : base;
  return Math.floor(rem / RIGA_REM + 1e-9);
}

/** Le classi della riga in linea del componente vero. */
function classiDellaRiga(html: string): string {
  return html.match(/<span class="([^"]*inline-flex[^"]*)"/)?.[1] ?? '';
}

// Tre negozi veri nei loro orari: un forno di mattina, un negozio con la pausa, uno aperto un giorno solo.
const FORNO = { sun: [], mon: [['08:00', '13:00']], tue: [['08:00', '13:00']], wed: [['08:00', '13:00']], thu: [['08:00', '13:00']], fri: [['08:00', '13:00']], sat: [['08:00', '13:00']] };
const CON_PAUSA = { sun: [], mon: [['15:00', '19:30']], tue: [['08:30', '13:00'], ['15:00', '19:30']], wed: [['08:30', '13:00'], ['15:00', '19:30']], thu: [['08:30', '13:00'], ['15:00', '19:30']], fri: [['08:30', '13:00'], ['15:00', '19:30']], sat: [['08:30', '13:00']] };
const UN_GIORNO = { sun: [], mon: [], tue: [], wed: [['09:00', '12:00']], thu: [], fri: [], sat: [] };

/** Tutte le frasi della scheda in una settimana intera, ogni quarto d'ora, con la veloce sì, no e non so. */
function tutteLeFrasi(): string[] {
  const frasi = new Set<string>();
  frasi.add(rigaConsegnaDellaScheda({ esaurito: false, orari: FORNO, adesso: null, veloce: null })!);
  for (const orari of [FORNO, CON_PAUSA, UN_GIORNO, null]) {
    for (let minuti = 0; minuti < 7 * 24 * 60; minuti += 15) {
      for (const veloce of [null, true, false]) {
        const riga = rigaConsegnaDellaScheda({ esaurito: false, orari, adesso: new Date(2026, 10, 16, 0, minuti), veloce });
        if (riga) frasi.add(riga);
      }
    }
  }
  return [...frasi];
}

describe('R02-009 · la riga della consegna in linea tiene da subito lo spazio della frase più lunga', () => {
  const classi = classiDellaRiga(renderToStaticMarkup(createElement(DeliveryCutoff, { variant: 'inline' })));
  const frasi = tutteLeFrasi();

  it('controprova: la frase del negozio chiuso c è, ed è la più lunga (tre righe sul telefono)', () => {
    const chiuso = frasi.find((f) => f.startsWith('Il negozio è chiuso ora, riapre domani alle 08:00: in cassa'));
    expect(chiuso, 'la regola della scheda non scrive più la frase del negozio chiuso: questa prova va rivista').toBeTruthy();
    expect(righeChieste(chiuso!, 279)).toBe(3);
    expect(classi, 'la riga in linea del componente non si trova').toMatch(/inline-flex/);
  });

  for (const { schermo, testo } of COLONNE) {
    it(`a ${schermo} pixel nessuna frase chiede più righe di quelle tenute prima del caricamento`, () => {
      const riservate = righeRiservate(classi, schermo);
      const troppoLunghe = frasi.filter((f) => righeChieste(f, testo) > riservate);
      expect(
        troppoLunghe,
        `la riga tiene ${riservate} righe e queste frasi ne chiedono di più: il riquadro cresce dopo il caricamento`,
      ).toEqual([]);
    });
  }

  it('dove la colonna è larga (da 1280) restano due righe, come prima: niente spazio vuoto in più', () => {
    expect(righeRiservate(classi, 1280)).toBe(2);
  });

  it('la banner resta com era (due righe di 3,5rem con il padding)', () => {
    const html = renderToStaticMarkup(createElement(DeliveryCutoff, { variant: 'banner', senzaNegozio: true }));
    expect(html).toContain('min-h-[3.5rem]');
  });
});

describe('R02-009 · il componente vero col forno chiuso, sull orologio finto', () => {
  let schermo: ReturnType<typeof accendi> | null = null;
  afterEach(() => {
    schermo?.smonta();
    schermo = null;
    vi.useRealTimers();
  });

  it('giovedì 19/11 alle 21:30 il forno è chiuso: la frase lunga entra nello spazio tenuto prima del caricamento', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T20:30:00Z')); // 21:30 a Piacenza
    // Prima del caricamento (niente orologio): la frase corta, e lo spazio già tenuto.
    const primaHtml = renderToStaticMarkup(createElement(DeliveryCutoff, { variant: 'inline', storeHours: FORNO }));
    expect(primaHtml).toContain('Consegna a casa, all&#x27;ora che scegli');
    const riservate = righeRiservate(classiDellaRiga(primaHtml), 360);

    schermo = accendi(DeliveryCutoff, { variant: 'inline', storeHours: FORNO });
    await act(async () => { await Promise.resolve(); });
    const riga = schermo.radice.querySelector('span.inline-flex')!;
    const dopo = riga.textContent ?? '';
    expect(dopo).toBe('Il negozio è chiuso ora, riapre domani alle 08:00: in cassa scegli l\'ora della consegna');
    expect(righeRiservate(riga.getAttribute('class') ?? '', 360), 'la classe cambia dopo il caricamento').toBe(riservate);
    expect(
      righeChieste(dopo, 279),
      `sul telefono la frase dopo il caricamento chiede più delle ${riservate} righe tenute: il riquadro cresce`,
    ).toBeLessThanOrEqual(riservate);
  });
});
