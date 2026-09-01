/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { contrasto } from './aiuti/contrasto';

/**
 * 27/8/2026 (R110) — TRE TESTI SOTTO LA SOGLIA, MISURATI SUI COLORI VERI.
 *
 * Le regole di accessibilità chiedono che un testo normale stacchi dal suo
 * sfondo almeno 4,5 volte, e che le parti grafiche di un comando (una «×», una
 * freccia) stacchino almeno 3 volte. Sotto quella soglia il testo non sparisce:
 * semplicemente smette di essere leggibile a chi ha poca vista, a chi guarda il
 * telefono al sole, a chi ha lo schermo con poco contrasto — cioè a molta più
 * gente di quanta si pensi.
 *
 * I tre casi, coi numeri ricalcolati sui colori scritti in `tailwind.config.ts`:
 *  · il passo del checkout non ancora raggiunto: `text-ink-400` su fondo pagina
 *    `cream-100` = 4,49:1, appena sotto il 4,5 richiesto;
 *  · la «×» che chiude il suggerimento dell'indirizzo: `text-ink-300` su bianco
 *    = 2,52:1, contro il 3:1 richiesto, e per di più un bersaglio da 14 pixel
 *    senza margine attorno;
 *  · il testo della barra in alto quando ci passi sopra: `accent-300` su
 *    `primary-700` = 3,87:1.
 *
 * Questa prova non si fida dei numeri scritti a mano: legge i colori veri dal
 * file dei colori, legge le classi che i componenti mettono davvero a video, e
 * rifà il conto.
 */

const SOGLIA_TESTO = 4.5;
const SOGLIA_GRAFICA = 3;

type Tavolozza = Record<string, Record<string, string>>;

async function tavolozza(): Promise<Tavolozza> {
  const mod = await monta('tailwind.config.ts');
  const config = mod.default as { theme?: { extend?: { colors?: Tavolozza } } };
  return config.theme?.extend?.colors ?? {};
}

/** Da «text-ink-400» (o «hover:text-accent-300») al colore vero. */
function coloreDellaClasse(classi: string, prefisso: string, colori: Tavolozza): { classe: string; hex: string } | null {
  for (const c of classi.split(/\s+/)) {
    const m = c.match(new RegExp(`^${prefisso}([a-z]+)-(\\d+)$`));
    if (!m) continue;
    const hex = colori[m[1]]?.[m[2]];
    if (hex) return { classe: c, hex };
  }
  return null;
}

describe('i passi del checkout', () => {
  it('il passo non ancora raggiunto si legge sul fondo della pagina', async () => {
    const colori = await tavolozza();
    const sfondoPagina = colori.cream['100'];

    const mod = await monta('components/checkout/StepIndicator.tsx');
    const s = accendi(mod.StepIndicator, { steps: mod.CHECKOUT_STEPS, currentStep: 1 });

    const etichetta = Array.from(s.radice.querySelectorAll('span')).find(
      (e) => e.textContent?.trim() === 'Indirizzo',
    )!;
    expect(etichetta, 'Il passo «Indirizzo» non c\'è più nella barra del checkout').toBeTruthy();

    const trovato = coloreDellaClasse(etichetta.className, 'text-', colori);
    expect(trovato, `Non riconosco il colore del passo: ${etichetta.className}`).toBeTruthy();

    const misura = contrasto(trovato!.hex, sfondoPagina);
    expect(
      misura,
      `«Indirizzo» è ${trovato!.classe} (${trovato!.hex}) sul fondo pagina ${sfondoPagina}: stacca ${misura.toFixed(2)} volte, ne servono ${SOGLIA_TESTO}`,
    ).toBeGreaterThanOrEqual(SOGLIA_TESTO);
    s.smonta();
  }, 60000);
});

describe('il suggerimento dell\'indirizzo di consegna', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('la «×» che lo chiude si vede, ed è abbastanza grande da colpirla', async () => {
    const colori = await tavolozza();
    const mod = await monta('components/LocationPill.tsx');
    const s = accendi(mod.default, {});
    s.agisci(() => vi.advanceTimersByTime(2000));

    const chiudi = Array.from(s.radice.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Chiudi',
    )!;
    expect(chiudi, 'Il suggerimento «Dove ti consegniamo?» non è comparso').toBeTruthy();

    const trovato = coloreDellaClasse(chiudi.className, 'text-', colori);
    expect(trovato, `Non riconosco il colore della «×»: ${chiudi.className}`).toBeTruthy();

    const misura = contrasto(trovato!.hex, '#FFFFFF');
    expect(
      misura,
      `La «×» è ${trovato!.classe} (${trovato!.hex}) su bianco: stacca ${misura.toFixed(2)} volte, ne servono ${SOGLIA_GRAFICA}`,
    ).toBeGreaterThanOrEqual(SOGLIA_GRAFICA);

    expect(
      /\bp-[0-9.]+\b|\bpadding\b/.test(chiudi.className),
      'La «×» era un bersaglio da 14 pixel senza un filo di margine attorno: con un dito si sbaglia',
    ).toBe(true);
    s.smonta();
  }, 60000);
});

describe('la barra in alto, quando ci passi sopra', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__PROFILO__ = {};
    // Nessuna risposta dal database: ogni pezzo usa i suoi valori di partenza.
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = undefined;
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('il testo evidenziato si legge sul terracotta della barra', async () => {
    const colori = await tavolozza();
    const sfondoBarra = colori.primary['700'];

    const mod = await monta('components/Navbar.tsx');
    const s = accendi(mod.default, {});

    const evidenziati = Array.from(s.radice.querySelectorAll<HTMLElement>('[class*="hover:text-accent-"]'));
    expect(evidenziati.length, 'Nella barra non c\'è più nessun testo che si evidenzia: la prova non guarda niente').toBeGreaterThan(0);

    const deboli = evidenziati
      .map((e) => coloreDellaClasse(e.className, 'hover:text-', colori))
      .filter((t): t is { classe: string; hex: string } => !!t)
      .map((t) => ({ ...t, misura: contrasto(t.hex, sfondoBarra) }))
      .filter((t) => t.misura < SOGLIA_TESTO);

    expect(
      deboli.map((d) => `${d.classe} = ${d.misura.toFixed(2)}:1`),
      `Sul terracotta ${sfondoBarra} servono ${SOGLIA_TESTO} volte di stacco`,
    ).toEqual([]);
    s.smonta();
  }, 60000);
});
