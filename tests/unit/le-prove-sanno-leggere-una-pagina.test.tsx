import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import OrderTimeline from '@/components/OrderTimeline';

/**
 * 27/10/2026 — LE PROVE NON SAPEVANO LEGGERE UNA PAGINA.
 *
 * tsconfig.json tiene "jsx": "preserve" perché serve a Next.js, e vitest lo
 * ereditava: davanti al JSX di un componente si fermava con «Failed to parse
 * source for import analysis… make sure to not set jsx to preserve». Così
 * `vitest related` si bloccava su qualunque file di lib/ importato da un
 * componente, e nessuna prova poteva trasformare una pagina in testo.
 *
 * Questa prova prende un componente vero del sito — la linea dell'ordine che
 * vedono cliente, negozio e fattorino — e lo trasforma in HTML. Se vitest torna
 * a non capire il JSX, questo file non parte nemmeno: è il campanello.
 */
describe('le prove sanno leggere il JSX di un componente vero', () => {
  it("un ordine annullato scrive «Ordine annullato»", () => {
    const html = renderToStaticMarkup(
      <OrderTimeline status="CANCELED" canceledAt="2026-10-27T10:00:00.000Z" />,
    );
    expect(html).toContain('Ordine annullato');
    // L'icona arriva da lucide-react: anche un componente preso da un pacchetto finisce nell'HTML.
    expect(html).toContain('<svg');
  });

  it('un ordine appena ricevuto mostra le cinque tappe e la seconda «In corso…»', () => {
    const html = renderToStaticMarkup(
      <OrderTimeline status="PENDING" createdAt="2026-10-27T10:00:00.000Z" />,
    );
    expect(html).toContain('Ordine ricevuto');
    expect(html).toContain('In corso…');
    // Cinque <li> veri: il JSX è diventato elementi, non testo copiato.
    expect(html.match(/<li\b/g)).toHaveLength(5);
  });
});
