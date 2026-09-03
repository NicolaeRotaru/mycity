/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { contrasto } from './aiuti/contrasto';

/**
 * LA COLONNA DELLA CASSA PARLAVA TRE LINGUE, E UNA PASTIGLIA NON SI LEGGEVA.
 *
 * ① Tre sistemi di colore per gli avvisi, uno sotto l'altro: i riquadri di
 *    marca (accent), il giallo di Tailwind (amber) e il rosa di Tailwind
 *    (rose) usato come colore d'errore al posto del rosso di marca — proprio
 *    nel momento in cui la persona decide se pagare.
 * ② Le card di sinistra e il riepilogo di destra, affiancati nella stessa
 *    griglia, avevano angoli, bordi e ombra diversi.
 * ③ La pastiglia dello sconto ritiro e il pallino del passo fatto erano bianco
 *    su `olive-500`: 3,69 di stacco, sotto il 4,5 che serve a leggere.
 *
 * Le prime due si guardano nel sorgente (una pagina di 1.300 righe non si
 * monta); la terza si MISURA sul colore vero, montando il componente.
 */

const radice = process.cwd();
const leggi = (f: string) => readFileSync(join(radice, f), 'utf8');
const SOGLIA_TESTO = 4.5;

type Tavolozza = Record<string, Record<string, string>>;
async function tavolozza(): Promise<Tavolozza> {
  const mod = await monta('tailwind.config.ts');
  const config = mod.default as { theme?: { extend?: { colors?: Tavolozza } } };
  return config.theme?.extend?.colors ?? {};
}

function coloreDellaClasse(classi: string, prefisso: string, colori: Tavolozza): string | null {
  for (const c of classi.split(/\s+/)) {
    const m = c.match(new RegExp(`^${prefisso}([a-z]+)-(\\d+)$`));
    if (m && colori[m[1]]?.[m[2]]) return colori[m[1]][m[2]];
  }
  return null;
}

describe('gli avvisi della cassa usano i colori di marca', () => {
  const src = leggi('app/checkout/page.tsx');

  it('niente più giallo e rosa di Tailwind nella colonna del checkout', () => {
    // amber e rose non esistono in tailwind.config.ts: erano due famiglie
    // estranee alla marca, mescolate ai riquadri di brand.
    expect(src).not.toMatch(/\b(bg|border|text|hover:bg)-(amber|rose)-\d{2,3}\b/);
  });

  it('e i colori di marca usati per gli avvisi esistono davvero nella tavolozza', async () => {
    const colori = await tavolozza();
    for (const famiglia of ['accent', 'secondary', 'olive', 'primary']) {
      expect(colori[famiglia], `la famiglia ${famiglia} non esiste più`).toBeTruthy();
    }
  });
});

describe('una sola card per il percorso d’acquisto', () => {
  it('i passi e il riepilogo usano la stessa variante', () => {
    expect(leggi('components/checkout/StepCard.tsx')).toContain('variant="funnel"');
    expect(leggi('app/checkout/page.tsx')).toContain('<Card variant="funnel"');
  });

  it('e il riepilogo non riscrive più le classi a mano', () => {
    expect(leggi('app/checkout/page.tsx')).not.toContain('bg-white border border-surface-200 rounded-xl shadow-card');
  });

  it('la variante esiste nella card condivisa', () => {
    const card = leggi('components/ui/Card.tsx');
    expect(card).toMatch(/funnel:\s*'bg-white border border-surface-200 shadow-card'/);
  });
});

describe('mentre arriva il carrello la pagina non diventa un cerchietto', () => {
  const src = leggi('app/checkout/page.tsx');

  it('il titolo e i passi restano a schermo', () => {
    const attesa = src.slice(src.indexOf('vistaCarrello.mostraScheletro'), src.indexOf('vistaCarrello.mostraVuoto'));
    expect(attesa).toContain('<StepIndicator');
    expect(attesa).toContain('Conferma il tuo ordine');
    expect(attesa).toContain('<ScheletroCassa />');
  });

  it('lo scheletro ha la forma di quello che arriva: tre riquadri e il riepilogo', () => {
    const scheletro = leggi('components/checkout/ScheletroCassa.tsx');
    expect(scheletro).toContain('lg:grid-cols-3');
    expect(scheletro).toMatch(/\[0, 1, 2\]\.map/);
    expect((scheletro.match(/skeleton/g) ?? []).length).toBeGreaterThan(4);
  });
});

describe('le pastiglie bianche della cassa si leggono', () => {
  it('lo sconto del ritiro in negozio stacca almeno 4,5 volte dal bianco', async () => {
    const colori = await tavolozza();
    const mod = await monta('components/checkout/PaymentMethodSelector.tsx');
    const s = accendi(mod.PaymentMethodSelector, {
      value: 'cod',
      onChange: () => {},
      stripeAvailable: true,
      multiSeller: false,
      pickupInStore: true,
      onPickupChange: () => {},
      pickupDiscount: 2.5,
      pickupDiscountPercent: 10,
    });

    const pastiglie = Array.from(s.radice.querySelectorAll('span')).filter((e) =>
      /bg-olive-\d+/.test(e.className) && /text-white/.test(e.className),
    );
    for (const p of pastiglie) {
      const sfondo = coloreDellaClasse(p.className, 'bg-', colori);
      expect(sfondo, `non riconosco lo sfondo: ${p.className}`).toBeTruthy();
      expect(contrasto('#FFFFFF', sfondo!), `${p.className} stacca troppo poco`).toBeGreaterThanOrEqual(SOGLIA_TESTO);
    }
  });

  it('il pallino del passo già fatto stacca almeno 4,5 volte dal bianco', async () => {
    const colori = await tavolozza();
    const mod = await monta('components/checkout/StepIndicator.tsx');
    const s = accendi(mod.StepIndicator, { steps: mod.CHECKOUT_STEPS, currentStep: 2 });

    const pallini = Array.from(s.radice.querySelectorAll('div')).filter((e) =>
      /bg-olive-\d+/.test(e.className) && /text-white/.test(e.className),
    );
    expect(pallini.length, 'nessun passo «fatto» nella barra dei passi').toBeGreaterThan(0);
    for (const p of pallini) {
      const sfondo = coloreDellaClasse(p.className, 'bg-', colori);
      expect(contrasto('#FFFFFF', sfondo!), `${p.className} stacca troppo poco`).toBeGreaterThanOrEqual(SOGLIA_TESTO);
    }
  });
});

describe('la spedizione gratuita, in cassa, la dice chi la decide', () => {
  it('la cassa non scrive a mano la frase sul costo di consegna', () => {
    const src = leggi('app/checkout/page.tsx');
    expect(src).toContain("from '@/lib/promesse-pubbliche'");
    expect(src).toContain('promessaConsegna.dettaglioConsegna');
  });

  it('e quella frase nasce dalla cifra che la cassa addebita davvero', async () => {
    const { promessaSpedizione } = await import('@/lib/promesse-pubbliche');
    // Con la consegna a pagamento la riga si vede; a consegna gratis sparisce.
    expect(promessaSpedizione(50, 30, 300).dettaglioConsegna).toMatch(/3[.,]00/);
    expect(promessaSpedizione(50, 30, 0).dettaglioConsegna).toBeNull();
  });
});
