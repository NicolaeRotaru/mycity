import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  VARIABILE_BARRA_AZIONI,
  RESPIRO_SOTTO_IL_CONTENUTO,
  spazioSottoIlContenuto,
  seguiAltezzaBarraAzioni,
} from '@/lib/ui/altezza-barra-azioni';

/**
 * 30/8/2026 (R095) — SUL DETTAGLIO DELLA CONSEGNA LA BARRA COPRIVA I SOLDI.
 *
 * L'ultima riga del contenuto e' «Totale (da incassare)»: l'importo che il
 * fattorino chiede al cliente sulla porta. Sotto il contenuto erano riservati
 * 80 pixel scritti a mano. La barra fissa, quando l'ordine e' gia' stato
 * ritirato, contiene DUE pulsanti grandi impilati — 48 + 8 + 48 di pulsanti,
 * piu' 12 sopra e 12 sotto: circa 128 pixel. Ne mancava una cinquantina, e a
 * finire sotto era proprio la riga dei soldi. Il guscio del fattorino, su
 * questa pagina, toglie apposta il proprio spazio di sicurezza: non c'era
 * nessuna rete.
 *
 * La cura corta era scrivere 140 al posto di 80. Non basta: al primo pulsante
 * in piu', o a una scritta che va a capo su uno schermo stretto, il numero
 * scritto a mano torna sbagliato in silenzio. Qui lo spazio SEGUE la barra.
 * Questa prova fa crescere la barra e guarda se lo spazio cresce con lei.
 */

/** Una radice finta che ricorda l'ultimo valore scritto per ogni variabile. */
function radiceFinta() {
  const scritte: Record<string, string> = {};
  return {
    scritte,
    style: { setProperty: (nome: string, valore: string) => { scritte[nome] = valore; } },
  };
}

/** Una barra che si puo' far crescere a comando, come fa un pulsante in piu'. */
function barraFinta(altezzaIniziale: number) {
  let avvisa: (() => void) | null = null;
  const barra = { offsetHeight: altezzaIniziale };
  return {
    barra,
    osserva: (_b: { offsetHeight: number }, quandoCambia: () => void) => {
      avvisa = quandoCambia;
      return () => { avvisa = null; };
    },
    cresciFinoA(px: number) {
      barra.offsetHeight = px;
      avvisa?.();
    },
    smessoDiGuardare: () => avvisa === null,
  };
}

describe('lo spazio sotto il contenuto della consegna', () => {
  it('lascia la barra piu il respiro, non un numero scritto a mano', () => {
    expect(spazioSottoIlContenuto()).toBe(
      `calc(var(${VARIABILE_BARRA_AZIONI}, 128px) + ${RESPIRO_SOTTO_IL_CONTENUTO}px)`,
    );
  });

  it('quando la barra cresce, lo spazio riservato cresce con lei', () => {
    // Il caso vero: dallo stato «assegnato» (un pulsante, ~72px) a «ritirato»
    // (due pulsanti impilati, ~128px). Prima erano 80 pixel fissi in tutti e due
    // gli stati: nel secondo mancavano quarantotto pixel, e sotto ci finiva la
    // riga dell'importo da incassare.
    const radice = radiceFinta();
    const f = barraFinta(72);

    const smetti = seguiAltezzaBarraAzioni(f.barra, radice, f.osserva);
    expect(radice.scritte[VARIABILE_BARRA_AZIONI]).toBe('72px');

    f.cresciFinoA(128);
    expect(
      radice.scritte[VARIABILE_BARRA_AZIONI],
      'La barra e cresciuta e lo spazio sotto il contenuto e rimasto quello di prima: il totale da incassare torna coperto',
    ).toBe('128px');

    smetti();
    expect(radice.scritte[VARIABILE_BARRA_AZIONI]).toBe('0px');
    expect(f.smessoDiGuardare(), 'l\'osservatore resta attaccato a una barra che non c\'e piu').toBe(true);
  });

  it('quando la barra non c\'e — consegna gia chiusa — dichiara zero, non un numero inventato', () => {
    const radice = radiceFinta();
    const smetti = seguiAltezzaBarraAzioni(null, radice, () => () => {});
    expect(radice.scritte[VARIABILE_BARRA_AZIONI]).toBe('0px');
    smetti();
  });

  it('la pagina della consegna non riserva piu uno spazio scritto a mano', () => {
    // Il numero fisso era `pb-[calc(80px+env(safe-area-inset-bottom,0px))]`.
    const src = readFileSync(join(process.cwd(), 'app/rider/orders/[id]/page.tsx'), 'utf8');
    expect(src).not.toMatch(/pb-\[calc\(80px/);
    expect(src).toContain('spazioSottoIlContenuto');
  });
});
