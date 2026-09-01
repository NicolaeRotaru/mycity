/**
 * Il contrasto fra due colori, come lo calcola WCAG: la luminanza relativa dei
 * due, il più chiaro sopra il più scuro, più 0,05 per parte.
 *
 * Le soglie che contano qui:
 *  · 4,5:1 per il testo normale (WCAG 1.4.3, livello AA);
 *  · 3:1 per il testo grande e per le parti grafiche di un comando (1.4.11).
 */
export function daEsadecimale(colore: string): [number, number, number] {
  const c = colore.replace('#', '').trim();
  const pieno = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  return [
    parseInt(pieno.slice(0, 2), 16),
    parseInt(pieno.slice(2, 4), 16),
    parseInt(pieno.slice(4, 6), 16),
  ];
}

function luminanza(colore: string): number {
  const [r, g, b] = daEsadecimale(colore).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrasto(primo: string, secondo: string): number {
  const a = luminanza(primo);
  const b = luminanza(secondo);
  const chiaro = Math.max(a, b);
  const scuro = Math.min(a, b);
  return (chiaro + 0.05) / (scuro + 0.05);
}
