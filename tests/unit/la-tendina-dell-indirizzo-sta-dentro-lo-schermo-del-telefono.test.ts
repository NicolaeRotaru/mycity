/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

/**
 * LA TENDINA CHE USCIVA DALLO SCHERMO E FACEVA SCORRERE LA PAGINA DI LATO.
 *
 * Sul telefono la pillola «dove consegniamo» sta in mezzo alla barra in alto,
 * fra il logo e il carrello. La tendina che apriva era larga 288 pixel fissi e
 * partiva dal bordo sinistro della pillola: su uno schermo da 360 cominciava
 * oltre metà larghezza e finiva fuori. Sopra non c'è nessun `overflow-x`
 * nascosto che la tagli — quindi la pagina prendeva lo scorrimento laterale, e
 * la metà destra del campo CAP e del pulsante di conferma restava fuori.
 *
 * Qui il conto non lo fa jsdom (non impagina): lo fa la prova. Legge le classi
 * che il pannello mette DAVVERO a video, le traduce in pixel su uno schermo da
 * 360, e guarda dove finisce il suo bordo destro. Un pannello agganciato alla
 * pillola non ci sta qualunque cosa si scriva: la pillola può stare ovunque
 * sulla riga. Uno agganciato allo schermo ci sta per costruzione.
 */

const SCHERMO = 360;      // il telefono piccolo che si vede ancora negli ordini
const PASSO = 4;          // in Tailwind una unità di spazio vale 4 pixel

/** Le classi che valgono davvero sul telefono: quelle senza prefisso di formato. */
function sulTelefono(classi: string): string[] {
  return classi.split(/\s+/).filter((c) => c && !c.includes(':'));
}

/** Le classi che si accendono da un certo formato in su (`md:` e simili). */
function dalFormato(classi: string, formato: string): string[] {
  return classi
    .split(/\s+/)
    .filter((c) => c.startsWith(`${formato}:`))
    .map((c) => c.slice(formato.length + 1));
}

function lunghezza(valore: string): number | null {
  if (valore === 'auto' || valore === 'full') return null;
  const n = Number(valore);
  return Number.isFinite(n) ? n * PASSO : null;
}

type Banda = { sinistra: number; destra: number; ancoratoAlloSchermo: boolean };

/**
 * Il pezzo di riga che il pannello occupa, in pixel, su uno schermo largo
 * `SCHERMO`, sapendo che la pillola che lo apre comincia a `pillola`.
 */
function banda(classi: string[], pillola: number): Banda {
  const valore = (prefisso: string): number | null => {
    const c = classi.find((x) => x.startsWith(prefisso));
    return c ? lunghezza(c.slice(prefisso.length)) : null;
  };
  const ancoratoAlloSchermo = classi.includes('fixed');
  const daSinistra = valore('left-');
  const daDestra = valore('right-');
  const larghezza = valore('w-');

  // Agganciato allo schermo e tenuto per tutti e due i lati: sta dentro sempre.
  if (ancoratoAlloSchermo && daSinistra !== null && daDestra !== null) {
    return { sinistra: daSinistra, destra: SCHERMO - daDestra, ancoratoAlloSchermo };
  }
  // Agganciato alla pillola, con una larghezza sua: parte da dove sta la pillola.
  if (!ancoratoAlloSchermo && daSinistra !== null && larghezza !== null) {
    return { sinistra: pillola + daSinistra, destra: pillola + daSinistra + larghezza, ancoratoAlloSchermo };
  }
  // Nessun modo indovinato: meglio fermarsi che dare per buono un conto sbagliato.
  throw new Error(
    `Non so dire dove finisce un pannello posizionato così: «${classi.join(' ')}». `
    + 'Se hai cambiato il modo in cui il pannello si aggancia, aggiorna il conto qui dentro.',
  );
}

/** Ogni punto in cui la pillola può trovarsi sulla riga della barra. */
const POSIZIONI_DELLA_PILLOLA = [0, 110, 150, 180, 260, 340];

function sforamenti(classi: string): string[] {
  return POSIZIONI_DELLA_PILLOLA.flatMap((pillola) => {
    const b = banda(sulTelefono(classi), pillola);
    if (b.sinistra >= 0 && b.destra <= SCHERMO) return [];
    return [
      `con la pillola a ${pillola}px il pannello va da ${Math.round(b.sinistra)} a ${Math.round(b.destra)}, fuori dallo schermo da ${SCHERMO}`,
    ];
  });
}

function apriLaTendina(radice: HTMLElement, agisci: (a: () => void) => void): HTMLElement {
  const pillola = Array.from(radice.querySelectorAll('button')).find(
    (b) => b.getAttribute('title') === 'Cambia indirizzo di consegna',
  );
  expect(pillola, 'La pillola dell\'indirizzo non c\'è più: la prova non guarda niente').toBeTruthy();
  agisci(() => clicca(pillola!));
  const tendina = radice.querySelector<HTMLElement>('[role="dialog"]');
  expect(tendina, 'La pillola non apre più nessuna tendina').toBeTruthy();
  return tendina!;
}

describe('la tendina per cambiare il CAP, sul telefono', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sta dentro lo schermo da 360, dovunque si trovi la pillola', async () => {
    const mod = await monta('components/LocationPill.tsx');
    const s = accendi(mod.default, { compact: true });
    const tendina = apriLaTendina(s.radice, s.agisci);

    expect(
      sforamenti(tendina.className),
      'La tendina esce dal bordo dello schermo e la pagina prende lo scorrimento laterale: il campo CAP e il pulsante di conferma restano tagliati',
    ).toEqual([]);
    s.smonta();
  }, 60000);

  it('sul telefono è agganciata allo schermo, non alla pillola', async () => {
    const mod = await monta('components/LocationPill.tsx');
    const s = accendi(mod.default, { compact: true });
    const tendina = apriLaTendina(s.radice, s.agisci);

    expect(
      banda(sulTelefono(tendina.className), 150).ancoratoAlloSchermo,
      'Finché il pannello è agganciato alla pillola, la sua larghezza fissa può sempre finire oltre il bordo: la pillola sta in mezzo alla barra',
    ).toBe(true);
    s.smonta();
  }, 60000);

  it('sul computer resta la tendina appesa alla pillola', async () => {
    const mod = await monta('components/LocationPill.tsx');
    const s = accendi(mod.default, { compact: true });
    const tendina = apriLaTendina(s.radice, s.agisci);

    expect(
      dalFormato(tendina.className, 'md'),
      'Da schermo grande la tendina deve tornare appesa alla pillola: un pannello che sale dal basso sul desktop sarebbe un peggioramento',
    ).toContain('absolute');
    s.smonta();
  }, 60000);
});

describe('il riquadro che suggerisce di mettere l\'indirizzo', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('sta dentro lo schermo da 360, dovunque si trovi la pillola', async () => {
    const mod = await monta('components/LocationPill.tsx');
    const s = accendi(mod.default, {});
    s.agisci(() => vi.advanceTimersByTime(2000));

    const chiudi = Array.from(s.radice.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Chiudi',
    );
    expect(chiudi, 'Il suggerimento «Dove ti consegniamo?» non è comparso').toBeTruthy();
    const riquadro = chiudi!.parentElement!;

    expect(sforamenti(riquadro.className)).toEqual([]);
    s.smonta();
  }, 60000);
});

describe('perché la tendina non può essere appesa alla pillola', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__PROFILO__ = {};
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = undefined;
  });
  afterEach(() => {
    document.body.innerHTML = '';
    delete (globalThis as Record<string, unknown>).__PROFILO__;
  });

  it('nella barra del telefono la pillola sta in mezzo, fra il logo e il carrello', async () => {
    const mod = await monta('components/Navbar.tsx');
    const s = accendi(mod.default, {});

    const pillole = Array.from(s.radice.querySelectorAll('button')).filter(
      (b) => b.getAttribute('title') === 'Cambia indirizzo di consegna',
    );
    expect(pillole.length, 'Nella barra non c\'è più la pillola dell\'indirizzo').toBeGreaterThan(0);

    const centrata = pillole.some((p) => {
      let n: HTMLElement | null = p.parentElement;
      for (let i = 0; i < 3 && n; i++, n = n.parentElement) {
        if (n.className.includes('justify-center') && n.className.includes('flex-1')) return true;
      }
      return false;
    });
    expect(
      centrata,
      'Questa prova dà per scontato che sul telefono la pillola sia centrata nella riga: se non lo è più, il conto qui sopra va rifatto',
    ).toBe(true);
    s.smonta();
  }, 60000);
});
