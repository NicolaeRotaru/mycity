import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ShippingPage from '@/app/shipping/page';
import { vociDellaConsegna } from '@/lib/ordini/prezzi';
import {
  RIGA_COME_SI_CALCOLA,
  fraseComeArriva,
  fraseTariffaConsegna,
  rispostaCostoSpedizione,
  spiegazioneDellaConsegna,
} from '@/lib/promesse-pubbliche';
import { CONSEGNA_NEGOZIO_IN_PIU_CENTS, PLATFORM_DELIVERY_FEE_CENTS } from '@/lib/constants';
import { QUANDO_SI_PUO_LA_VELOCE } from '@/lib/promessa-consegna';
import { formatPrice } from '@/lib/format';

/**
 * 30/10/2026 — LA PAGINA SPEDIZIONI DICE LA CONSEGNA DI OGGI (ondata 18).
 *
 * La regola di Nicola (registro dei fatti, consegna.promessa, 29/10 22:21): una consegna sola per
 * tutto il carrello, 3 € di base, 1 € per ogni negozio in più, 1 € per ogni negozio sotto i 10 €,
 * la veloce 1 € una volta sola. Il corpo della pagina Spedizioni era rimasto alla regola delle
 * 16:13: «Paghi solo la consegna, per ogni negozio da cui ordini» e «Se ordini da due negozi paghi
 * due consegne». Pane 15 € e frutta 12 €: la cassa conta una consegna da 4 €, la pagina ne
 * prometteva due. E la FAQ mandava «agli esempi della pagina Spedizioni», che non c'erano.
 *
 * Qui si guarda la pagina DISEGNATA, e la regola che dice si confronta con la funzione della cassa.
 * La FAQ manda agli esempi dove ci sono davvero: se dice Spedizioni, la pagina li deve disegnare.
 */

const euro = (cents: number) => formatPrice(cents / 100);

function testoDi(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t\r\n]+/g, ' ');
}

function blocchiDi(html: string): string[] {
  return html
    .split(/<\/(?:p|li|div|h[1-6])>|<br\s*\/?>/i)
    .map((b) => testoDi(b).trim())
    .filter(Boolean);
}

/** Quanto chiede la cassa per questi negozi (merce in centesimi), con la fascia o con la veloce. */
function cassa(merci: number[], veloce: boolean): number {
  return vociDellaConsegna({
    pickupInStore: false,
    negozi: merci.map((m) => ({ spesaCents: m, merceCents: m })),
    consegnaVeloce: veloce,
  }).totaleCents;
}

const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

describe('la pagina Spedizioni: una consegna sola per tutto il carrello', () => {
  const blocchi = blocchiDi(renderToStaticMarkup(createElement(ShippingPage)));
  const pagina = blocchi.join(' | ');

  it('nessun blocco promette una consegna per negozio', () => {
    const vecchi = blocchi.filter((b) => /per ogni negozio da cui ordini|due consegne|ogni negozio ti porta la sua spesa/i.test(b));
    expect(vecchi).toEqual([]);
  });

  it('il paragrafo del prezzo dice la tariffa come nasce, senza la cornice vecchia', () => {
    const tariffa = blocchi.find((b) => b.includes(fraseTariffaConsegna()));
    expect(tariffa, `non trovo la tariffa nella pagina: ${pagina}`).toBeTruthy();
    expect(tariffa).not.toMatch(/per ogni negozio da cui ordini/);
  });

  it('IL CASO DELLA SCHEDA — pane 15 € e frutta 12 €: la pagina dice base più un negozio in più, cioè i 4 € della cassa', () => {
    expect(cassa([1500, 1200], false)).toBe(400);
    expect(cassa([1500, 1200], false)).toBe(PLATFORM_DELIVERY_FEE_CENTS + CONSEGNA_NEGOZIO_IN_PIU_CENTS);
    expect(pagina).toContain(`${euro(PLATFORM_DELIVERY_FEE_CENTS)} una volta sola per tutto il carrello`);
    expect(pagina).toContain(`${euro(CONSEGNA_NEGOZIO_IN_PIU_CENTS)} in più per ogni negozio in più`);
    expect(blocchi.some((b) => /più negozi[^.]*resta una/.test(b)), `la pagina non dice che con più negozi la consegna resta una: ${pagina}`).toBe(true);
  });

  it('la FAQ manda agli esempi dove ci sono davvero, con le cifre della cassa (15 € → 3 €, 8 € → 4 €, veloce +1 € una volta)', () => {
    const faq = rispostaCostoSpedizione().a;
    const esempi = spiegazioneDellaConsegna('').esempi;
    if (/esempi[^.]*pagina Spedizioni/.test(faq)) {
      for (const e of esempi) expect(pagina.toLowerCase(), `la FAQ promette a Spedizioni l'esempio «${e}»`).toContain(e.toLowerCase());
    } else {
      expect(faq).toContain(`«${RIGA_COME_SI_CALCOLA}»`);
      const carrello = senzaCommenti(readFileSync(join(process.cwd(), 'app/cart/page.tsx'), 'utf8'));
      expect(carrello).toContain('RIGA_COME_SI_CALCOLA');
      expect(carrello).toContain('spiegazione.esempi');
    }
    // Gli esempi sono i carrelli della regola di Nicola, contati dalla cassa.
    expect(esempi[0]).toContain(`${euro(1500)}: ${euro(300)} all’ora che scegli, ${euro(400)} con la veloce`);
    expect(esempi[1]).toContain(`${euro(800)}: ${euro(400)} all’ora che scegli, ${euro(400)} con la veloce`);
    expect(esempi[2]).toContain(`${euro(1500)} + ${euro(1200)}: ${euro(400)} all’ora che scegli, ${euro(500)} con la veloce`);
    expect(cassa([1500, 1200], true)).toBe(500);
  });
});

describe('i commenti di promesse-pubbliche.ts dicono il vero', () => {
  const src = readFileSync(join(process.cwd(), 'lib/promesse-pubbliche.ts'), 'utf8');

  function commentoSopra(firma: string): string {
    const i = src.indexOf(firma);
    expect(i, `non trovo ${firma}`).toBeGreaterThan(0);
    const prima = src.slice(0, i).trimEnd();
    expect(prima.endsWith('*/'), `${firma} non ha un commento attaccato`).toBe(true);
    return prima.slice(prima.lastIndexOf('/**'));
  }

  it('il blocco del codice «Spedizione gratuita» sta sopra la sua funzione, e non dice più «per negozio tutta»', () => {
    const c = commentoSopra('export function rigaDelCodiceSpedizione(');
    expect(c).toMatch(/SPEDIZIONE GRATUITA/);
    expect(c).not.toMatch(/per negozio tutta/);
  });

  it('sopra fraseTariffaConsegna c’è un commento solo, il suo', () => {
    const i = src.indexOf('export function fraseTariffaConsegna(');
    const prima = src.slice(0, i).trimEnd();
    const inizio = prima.lastIndexOf('/**');
    expect(prima.slice(0, inizio).trimEnd().endsWith('*/'), 'due blocchi di commento di fila sopra fraseTariffaConsegna').toBe(false);
  });

  it('costoConsegna è la base per tutto il carrello, non «per negozio»', () => {
    const riga = src.split('\n').findIndex((r) => /^\s*costoConsegna: number;/.test(r));
    const doc = src.split('\n').slice(riga - 3, riga).join('\n');
    expect(doc).toMatch(/per tutto il carrello/);
    expect(doc).not.toMatch(/per negozio/);
  });

  it('chi è nominato come utente di fraseTariffaConsegna la usa davvero', () => {
    const c = commentoSopra('export function fraseTariffaConsegna(');
    const admin = senzaCommenti(readFileSync(join(process.cwd(), 'app/admin/delivery/page.tsx'), 'utf8'));
    if (/La usano[^.]*pannello/.test(c)) expect(admin).toContain('fraseTariffaConsegna(');
    const spedizioni = senzaCommenti(readFileSync(join(process.cwd(), 'app/shipping/page.tsx'), 'utf8'));
    expect(spedizioni).toContain('fraseTariffaConsegna(');
  });

  it('il pannello consegne conta il suo esempio con la funzione della cassa', async () => {
    const { default: PaginaConsegne } = await import('@/app/admin/delivery/page');
    const html = testoDi(renderToStaticMarkup(createElement(PaginaConsegne)));
    expect(html).toContain(`fanno ${euro(cassa([500, 600, 700], false))}`);
    const admin = senzaCommenti(readFileSync(join(process.cwd(), 'app/admin/delivery/page.tsx'), 'utf8'));
    expect(admin, 'l’esempio dei tre negozi è riscritto a mano invece di chiederlo alla cassa').toContain('vociDellaConsegna(');
  });
});

describe('«Come funziona» dice le tre condizioni della veloce', () => {
  it('alle 15 col forno chiuso dall’una non basta il fattorino: la pagina lo dice', async () => {
    const { default: ComeFunziona } = await import('@/app/come-funziona/page');
    const t = testoDi(renderToStaticMarkup(createElement(ComeFunziona)));
    expect(t).toContain(QUANDO_SI_PUO_LA_VELOCE);
    expect(t).not.toMatch(/quando c'è un fattorino in servizio/);
  });

  it('la frase dei negozi per Google porta le tre condizioni e sta nei 160 caratteri', () => {
    expect(fraseComeArriva(false)).toContain(QUANDO_SI_PUO_LA_VELOCE);
    expect(fraseComeArriva(true)).toContain(QUANDO_SI_PUO_LA_VELOCE);
    expect(`Compra online da Panificio di prova su MyCity. ${fraseComeArriva(false)}`.length).toBeLessThanOrEqual(160);
  });
});

describe('l’anteprima della home su WhatsApp e Facebook', () => {
  it('dice quello che dice la descrizione per Google, non «Consegna rapida»', () => {
    const layout = senzaCommenti(readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8'));
    const og = layout.slice(layout.indexOf('openGraph:'), layout.indexOf('twitter:'));
    const tw = layout.slice(layout.indexOf('twitter:'), layout.indexOf('};', layout.indexOf('twitter:')));
    for (const [nome, blocco] of [['openGraph', og], ['twitter', tw]] as const) {
      expect(blocco, `${nome}: «rapida» senza tempo né confine`).not.toMatch(/rapida/i);
      expect(blocco, `${nome}: la descrizione non è quella per Google`).toMatch(/description:\s*DESCRIZIONE_DEL_SITO\b/);
    }
  });
});
