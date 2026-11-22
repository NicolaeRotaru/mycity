import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R07-001 — nei guadagni del fattorino le card dello storico erano scritte a mano
 * (`rounded-lg border border-cream-300 bg-surface-0`): ora sono la primitiva Card.
 * Prova statica: nel file non resta la card scritta a mano (`rounded-lg border ... bg-surface-0`) e le due card usano la variante.
 *
 * Collaudo del 22/11: restavano card a mano con bg-surface-0 anche negli altri file di R07
 * (consegna del fattorino e pagina dei documenti). Una «card a mano» è un contenitore
 * (div, section, article, aside, details) con bg-surface-0, un bordo e un raggio scritti a mano;
 * i campi di testo con le stesse classi non sono card e restano.
 */
const leggi = (...parti: string[]) => readFileSync(join(process.cwd(), ...parti), 'utf8');
const src = leggi('app', 'rider', 'earnings', 'page.tsx');

const CARD_A_MANO = /<(div|section|article|aside|details)\b[^>]*className="[^"]*\bbg-surface-0\b[^"]*"/g;
const cardAMano = (testo: string) =>
  (testo.match(CARD_A_MANO) ?? []).filter((t) => /\bborder\b/.test(t) && /\brounded-/.test(t));

describe('R07-001 — lo storico consegne usa la Card', () => {
  it('nessuna card a mano con bg-surface-0', () => {
    expect(src).not.toMatch(/rounded-lg border border-cream-300 bg-surface-0/);
  });
  it('le due card dello storico sono <Card variant="surface">', () => {
    expect(src.match(/<Card [^>]*variant="surface" radius="lg"/g)?.length).toBe(2);
  });
});

describe('R07-001 — nei file di R07 non restano card a mano con bg-surface-0', () => {
  const file: Record<string, { testo: string; card: number }> = {
    'app/rider/earnings/page.tsx': { testo: src, card: 2 },
    'app/rider/orders/[id]/page.tsx': { testo: leggi('app', 'rider', 'orders', '[id]', 'page.tsx'), card: 3 },
    'app/rider/onboarding/page.tsx': { testo: leggi('app', 'rider', 'onboarding', 'page.tsx'), card: 4 },
  };
  for (const [nome, { testo, card }] of Object.entries(file)) {
    it(`${nome}: nessun contenitore con bg-surface-0, bordo e raggio a mano`, () => {
      expect(cardAMano(testo)).toEqual([]);
    });
    it(`${nome}: le sue ${card} card sono <Card variant="surface">`, () => {
      expect(testo.match(/<Card\b[^>]*variant="surface"/g)?.length).toBe(card);
    });
  }
  it('il riquadro «Articoli» della consegna resta un <details> che si apre e si chiude', () => {
    expect(file['app/rider/orders/[id]/page.tsx'].testo).toMatch(/<Card as="details" variant="surface"/);
    expect(leggi('components', 'ui', 'Card.tsx')).toMatch(/as\?: [^;]*'details'/);
  });
});
