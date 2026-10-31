/**
 * @vitest-environment jsdom
 *
 * 28/10/2026 — ondata 10, pacchetto «lib/promesse-pubbliche.ts».
 *
 * Sette frasi che il sito diceva al cliente, al negozio o al fattorino, e che la realtà smentiva:
 *   ① «oppure con carta adesso» con la carta spenta in cassa (manca la chiave pubblica di Stripe);
 *   ② «la nostra parte è la consegna» mentre tratteniamo anche il 10% della merce;
 *   ③ «arriva oggi in 30-60 min» in home, anche di domenica, senza orari di nessun negozio;
 *   ④ «Consegna in 30-60 min · Rider del territorio» in home, senza un rider approvato;
 *   ⑤ il dialogo di conferma dichiarato modale da cui si usciva col Tab;
 *   ⑥ il telefono finto +39 0523 000000 in Contatti e come numero d'emergenza dei fattorini;
 *   ⑦ «Vegano false» e «Alt text» nella griglia delle caratteristiche.
 * Ogni prova guarda quello che la persona vede o fa, non la presenza di una parola nel codice.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => (k === 'cancel' ? 'Annulla' : k === 'confirm' ? 'Conferma' : k),
}));

import { frasePagamento, metodiAlCheckout, riquadroLoSapevi, RIQUADRO_LO_SAPEVI } from '@/lib/promesse-pubbliche';
import { MARKETPLACE_FEE_BPS } from '@/lib/constants';
import * as attributi from '@/lib/category-attributes';
import { DeliveryCutoff } from '@/components/ui/DeliveryCutoff';
import * as dialogo from '@/components/ConfirmDialog';
import ContactPage from '@/app/contact/page';
import RiderHelpPage from '@/app/rider/help/page';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

describe('① la frase sul pagamento segue la stessa condizione della cassa', () => {
  it('senza la chiave pubblica di Stripe la scheda dice solo contanti', () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', '');
    expect(frasePagamento()).toBe('Paghi in contanti alla consegna');
  });

  // 31/10/2026 — La chiave non basta più: la carta vuole anche CARTA_ACCESA (scelta di Nicola).
  it('con la chiave ma l\'interruttore spento la frase resta «solo contanti»', () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_123');
    expect(frasePagamento()).toBe('Paghi in contanti alla consegna');
  });

  it('con la chiave e l\'interruttore acceso la carta torna, da sé', () => {
    expect(frasePagamento(metodiAlCheckout('pk_test_123', true))).toBe('Paghi in contanti alla consegna, oppure con carta adesso');
    expect(metodiAlCheckout('   ', true)).toEqual(['contanti-alla-consegna']);
  });

  it('la cassa legge la stessa condizione, non una sua copia', () => {
    const src = senzaCommenti(readFileSync(join(process.cwd(), 'app/checkout/page.tsx'), 'utf8'));
    expect(src).toMatch(/stripeAvailable\s*=\s*cartaAlCheckoutDisponibile\(\)/);
  });
});

describe('② il riquadro «Lo sapevi?» dice la commissione che tratteniamo', () => {
  it('con una commissione maggiore di zero la frase non dice che la nostra parte è solo la consegna', () => {
    expect(MARKETPLACE_FEE_BPS).toBeGreaterThan(0);
    expect(RIQUADRO_LO_SAPEVI).not.toMatch(/ogni euro[^.]*va ai commercianti/i);
    expect(RIQUADRO_LO_SAPEVI).not.toMatch(/la nostra parte è la consegna/i);
    const percentuali = [...RIQUADRO_LO_SAPEVI.matchAll(/(\d+(?:,\d+)?)%/g)].map((m) => Number(m[1].replace(',', '.')));
    expect(percentuali).toContain(MARKETPLACE_FEE_BPS / 100);
    expect(percentuali).toContain(100 - MARKETPLACE_FEE_BPS / 100);
  });

  it('se la commissione cambia, cambia anche la frase', () => {
    expect(riquadroLoSapevi(1500)).toContain('a noi il 15%');
    expect(riquadroLoSapevi(1500)).toContain('85%');
  });
});

describe('③④ la home non promette «oggi» né minuti senza un negozio di cui sapere gli orari', () => {
  it('di domenica alle 10 il banner della home non dice «oggi» né «30-60»', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 1, 10, 0, 0)); // domenica 1/11/2026
    const html = renderToStaticMarkup(createElement(DeliveryCutoff, { variant: 'banner', senzaNegozio: true } as never));
    expect(html).not.toMatch(/oggi/i);
    expect(html).not.toMatch(/30-60/);
    expect(html).toMatch(/in giornata/i);
  });

  it('la home passa il banner senza negozio e non scrive più i minuti', () => {
    const home = senzaCommenti(readFileSync(join(process.cwd(), 'components/home-sections/HomeSectionRenderer.tsx'), 'utf8'));
    expect(home).toMatch(/<DeliveryCutoff[^>]*senzaNegozio/);
    expect(home).not.toMatch(/30-60/);
    const hero = senzaCommenti(readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8'));
    expect(hero).not.toMatch(/30-60|EXPRESS_ETA_LABEL/);
  });
});

describe('⑤ il dialogo di conferma trattiene il fuoco e lo riporta indietro', () => {
  it('Tab sull’ultimo bottone torna al primo, e alla chiusura il fuoco torna a chi l’ha aperto', async () => {
    const fuoco = (dialogo as Record<string, unknown>).fuocoSuccessivo;
    expect(typeof fuoco, 'manca la regola che fa girare il fuoco dentro il dialogo').toBe('function');

    const apri = document.createElement('button');
    apri.textContent = 'Annulla ordine';
    const fuori = document.createElement('button');
    fuori.textContent = 'Fuori';
    document.body.append(apri, fuori);
    const radice = document.createElement('div');
    document.body.append(radice);
    const root = createRoot(radice);
    await act(async () => root.render(createElement(dialogo.ConfirmDialogHost)));

    apri.focus();
    let esito: Promise<boolean> | null = null;
    await act(async () => {
      esito = dialogo.confirmDialog({ title: "Annullare l'ordine?", danger: true });
    });
    const bottoni = Array.from(radice.querySelectorAll('button'));
    expect(bottoni.length).toBe(2);
    bottoni[1].focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    bottoni[1].dispatchEvent(tab);
    expect(tab.defaultPrevented, 'col Tab si usciva dal dialogo modale').toBe(true);
    expect(document.activeElement).toBe(bottoni[0]);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await expect(esito).resolves.toBe(false);
    expect(document.activeElement, 'alla chiusura il fuoco cadeva sul corpo della pagina').toBe(apri);
    await act(async () => root.unmount());
  });
});

describe('⑥ nessun telefono finto dove la persona chiede aiuto', () => {
  it('Contatti senza numero configurato non mostra nessun telefono', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_PHONE', '');
    const html = renderToStaticMarkup(createElement(ContactPage));
    expect(html).not.toMatch(/0523 ?000000/);
    expect(html).not.toMatch(/tel:\+?390523000000/);
  });

  it('Contatti col numero vero lo mostra', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_PHONE', '+39 0523 123456');
    const html = renderToStaticMarkup(createElement(ContactPage));
    expect(html).toContain('tel:+390523123456');
  });

  it('l’aiuto dei fattorini manda gli infortuni al 112, non a un numero finto', () => {
    const html = renderToStaticMarkup(createElement(RiderHelpPage));
    expect(html).not.toMatch(/0523 ?000000|390523000000/);
    expect(html).toContain('tel:112');
  });
});

describe('⑦ le caratteristiche parlano italiano anche quando il sì/no è salvato come testo', () => {
  it('«true» e «false» testuali diventano Sì e No, e la casella non si spunta su «false»', () => {
    expect(attributi.formatAttributeValue('false')).toBe('No');
    expect(attributi.formatAttributeValue('true')).toBe('Sì');
    const spuntato = (attributi as Record<string, unknown>).attributoSpuntato as ((v: unknown) => boolean) | undefined;
    expect(typeof spuntato).toBe('function');
    expect(spuntato!('false')).toBe(false);
    expect(spuntato!('true')).toBe(true);
    expect(spuntato!(true)).toBe(true);
  });

  it('la descrizione per i non vedenti non finisce nella griglia', () => {
    const fuori = (attributi as Record<string, unknown>).CHIAVI_FUORI_DALLA_GRIGLIA as readonly string[] | undefined;
    expect(fuori ?? []).toContain('alt_text');
    const scheda = senzaCommenti(readFileSync(join(process.cwd(), 'app/product/[id]/page.tsx'), 'utf8'));
    expect(scheda).toMatch(/CHIAVI_FUORI_DALLA_GRIGLIA\.includes\(key\)/);
    const campi = readFileSync(join(process.cwd(), 'components/seller/AttributesFields.tsx'), 'utf8');
    expect(campi).not.toMatch(/checked=\{Boolean\(values\[f\.key\]\)\}/);
  });
});
