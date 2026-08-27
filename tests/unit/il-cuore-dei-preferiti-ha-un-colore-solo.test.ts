/**
 * «Il cuore dei preferiti è vino sulla card e rosa sulla scheda prodotto» — radiografia del design
 * del 22/8, dimensione Coerenza del marchio, gravità grave.
 *
 * Lo stesso gesto cambiava colore passando da una schermata all'altra: vino (`secondary-500`, il
 * colore del marchio, quello che il mockup prescrive) sulla card, fucsia (`rose-500`, una rampa che
 * Tailwind si porta dietro di suo) sulla scheda.
 *
 * La radice: le rampe di Tailwind sono raggiungibili accanto a quelle del marchio, quindi chi scrive
 * una schermata nuova pesca l'una o l'altra senza accorgersene. Un colore scritto a mano in due
 * posti diverge in silenzio.
 *
 * La prova ESEGUE la scelta del colore, e in più controlla che i due componenti non se lo riscrivano
 * a mano: senza il secondo pezzo, la casa unica esisterebbe e nessuno sarebbe obbligato a usarla —
 * che è la malattia curata due volte oggi dall'altra parte.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classiCuore,
  classiBottoneCuore,
  CUORE_ACCESO,
  BOTTONE_ACCESO,
  ANELLO,
} from '@/lib/design/cuore-preferito';

const RADICE = process.cwd();
const leggi = (p: string) => readFileSync(join(RADICE, p), 'utf8');

describe('il cuore dei preferiti', () => {
  it('acceso è vino, cioè il colore del marchio, in tutte e due le forme', () => {
    expect(classiCuore(true)).toContain('secondary-500');
    expect(classiBottoneCuore(true)).toContain('secondary-500');
    expect(CUORE_ACCESO).toContain('secondary-500');
    expect(BOTTONE_ACCESO).toContain('secondary-500');
  });

  it('nessuna delle classi pesca da una rampa che non è del marchio', () => {
    // `rose-*` non è un colore di MyCity: è quello che Tailwind porta di suo, ed è esattamente
    // la strada per cui il difetto è nato.
    for (const classi of [classiCuore(true), classiCuore(false), classiBottoneCuore(true), classiBottoneCuore(false), ANELLO]) {
      expect(classi).not.toMatch(/\brose-/);
      expect(classi).not.toMatch(/\bpink-/);
    }
  });

  it('spento e acceso sono due cose diverse: un cuore che non cambia non dice niente', () => {
    expect(classiCuore(true)).not.toEqual(classiCuore(false));
    expect(classiBottoneCuore(true)).not.toEqual(classiBottoneCuore(false));
  });

  it('i due componenti chiedono il colore alla casa unica invece di riscriverlo', () => {
    // Senza questo, la casa unica esisterebbe e nessuno sarebbe obbligato a passarci: è il difetto
    // «un cancello costruito bene su una porta che nessuno usa».
    const card = leggi('components/ProductCard.tsx');
    const scheda = leggi('app/product/[id]/page.tsx');
    // Si cerca la CHIAMATA, non il nome: la riga di import contiene il nome anche quando nessuno
    // la usa più, e con quella un `toContain` resterebbe verde. Misurato: rompendo l'uso e
    // lasciando l'import, la prova non se ne accorgeva.
    expect(card).toContain('classiCuore(isFav)');
    expect(scheda).toContain('classiBottoneCuore(isFav)');
  });

  it('e nessuno dei due si tiene un rosa scritto a mano sul cuore', () => {
    const scheda = leggi('app/product/[id]/page.tsx');
    // Si guarda il blocco del bottone dei preferiti, non tutto il file: altrove `rose-` può servire
    // per cose che non sono il cuore, e una prova che cerca nel file intero diventa rossa per il
    // motivo sbagliato.
    const i = scheda.indexOf('classiBottoneCuore');
    expect(i).toBeGreaterThan(-1);
    const blocco = scheda.slice(Math.max(0, i - 600), i + 600);
    expect(blocco).not.toMatch(/\brose-/);
  });
});
