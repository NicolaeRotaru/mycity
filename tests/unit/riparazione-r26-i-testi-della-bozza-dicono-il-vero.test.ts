/**
 * 26/11/2026 (R26-004) — LA PROVA DELLA BOZZA NON FINGE UNA SCADENZA CHE IL CODICE NON LEGGE.
 *
 * Tolta la scadenza da lib/bozza-checkout.ts (`scadeIl`), la prova di «Ho già un account» seminava
 * ancora `scadeIl` nella bozza finta e diceva nel titolo che `bozzaDaSalvare` porta «la scadenza».
 * Chi la leggeva credeva che la bozza con i dati personali avesse un campo che la fa scadere. La
 * scadenza vera (R26-016) si conta dall'ora del salvataggio, `sceltaIl`, e la controlla la cassa:
 * la bozza finta porta quel campo, e i titoli dicono quello.
 *
 * Prova leggera: guarda il testo della prova e della cassa (è una voce sui testi).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const PROVA = readFileSync('tests/unit/riparazione-r19-ho-gia-un-account-salva-la-bozza.test.ts', 'utf8');
const CASSA = readFileSync('app/checkout/page.tsx', 'utf8');

describe('R26-004 · i testi sulla bozza della cassa dicono la scadenza che c\'è davvero', () => {
  it('la bozza finta della prova di «Ho già un account» non porta un campo di scadenza che nessuno legge', () => {
    expect(PROVA, 'la prova semina ancora `scadeIl`, un campo che la cassa non legge').not.toMatch(/scadeIl/);
    expect(PROVA, 'la bozza finta deve portare l\'ora del salvataggio, da cui conta la scadenza').toMatch(/sceltaIl:/);
  });

  it('il titolo non dice che bozzaDaSalvare porta «la scadenza»', () => {
    expect(PROVA).not.toMatch(/bozzaDaSalvare \(con la scadenza\)/);
    expect(PROVA).toMatch(/bozzaDaSalvare \(che segna l\\?'ora del salvataggio/);
  });

  it('la cassa non promette una scadenza portata dalla bozza, e dice dove la conta', () => {
    expect(CASSA).not.toMatch(/porta anche la scadenza/);
    expect(CASSA).not.toMatch(/scadeIl/);
    expect(CASSA).toMatch(/const BOZZA_VALE_MS = 2 \* 60 \* 60 \* 1000;/);
  });
});
