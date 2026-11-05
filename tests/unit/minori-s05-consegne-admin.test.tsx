import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * S05 · schede 2318, 2264, 2292, 2086 — pagina admin «Zone & tariffe».
 */

vi.mock('@/lib/constants', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // 2318: con la soglia a 6 € l'esempio con 5/6/7 € fissi contava un supplemento solo.
  SPESA_SENZA_SUPPLEMENTO_CENTS: 600,
}));

async function html(): Promise<string> {
  const mod = (await import('@/app/admin/delivery/page')) as { default: () => JSX.Element };
  return renderToStaticMarkup(createElement(mod.default));
}

describe('pagina consegne dell’amministratore', () => {
  it('2318: «tre negozi sotto la soglia» resta vero anche se la soglia scende', async () => {
    const { vociDellaConsegna } = await import('@/lib/ordini/prezzi');
    const atteso = vociDellaConsegna({
      pickupInStore: false,
      negozi: [100, 100, 100].map((m) => ({ spesaCents: m, merceCents: m })),
      consegnaVeloce: false,
    }).totaleCents;
    const h = await html();
    const euro = (atteso / 100).toFixed(2).replace('.', ',');
    expect(h).toMatch(new RegExp(`fanno\\s*${euro}`));
  });

  it('2264/2292: una grafia sola del compenso, e nella riga dei Costi base il valore è corto', async () => {
    const h = await html();
    expect(h).not.toMatch(/3,00\s*€ il giro/);
    const riga = h.split('Compenso del fattorino').at(-1) ?? '';
    const valore = /<strong[^>]*>([^<]*)<\/strong>/.exec(riga)?.[1] ?? '';
    expect(valore.length, `valore troppo lungo: «${valore}»`).toBeLessThan(15);
  });

  it('2292: la veloce non scrive «un euro» a mano', async () => {
    expect(await html()).not.toMatch(/almeno un euro/);
  });

  it('2086: il valore non va a capo (shrink-0 e whitespace-nowrap), va a capo la spiegazione', async () => {
    const h = await html();
    const valore = /<strong class="([^"]*)">\d+ km<\/strong>/.exec(h)?.[1] ?? '';
    expect(valore).toContain('shrink-0');
    expect(valore).toContain('whitespace-nowrap');
    expect(h).toMatch(/class="flex min-w-0 flex-1 items-center gap-3"/);
  });
});
