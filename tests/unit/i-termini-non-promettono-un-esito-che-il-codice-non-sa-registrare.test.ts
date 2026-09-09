import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  esitiDelFattorinoInConsegna,
  fattiDellaConsegna,
  paragrafiConsegne,
  siPuoPromettereLaTrattenuta,
  type PassaggioDiStato,
} from '@/lib/legal/promessa-cliente-assente';

/**
 * IL §6 DEI TERMINI PROMETTEVA UN ESITO CHE IL SITO NON SA REGISTRARE.
 *
 * «In caso di assenza il Rider tenterà il contatto telefonico e, in caso di
 * esito negativo dopo tre tentativi, l'ordine potrà essere annullato con
 * rimborso al netto delle spese di consegna sostenute.» Tre promesse, zero
 * meccanismi: da «in consegna» il fattorino ha una strada sola (il codice di
 * consegna, che porta a «consegnato»), i tentativi telefonici non li scrive
 * nessuna tabella, e l'annullamento restituisce il totale intero — la quota di
 * consegna compresa.
 *
 * Il venerdì sera vero: ordine da 25 € di Pane Quotidiano, il cliente non
 * risponde al citofono. Il rider non ha nessun pulsante, l'ordine resta fermo
 * in consegna, il negozio non vede il payout, e quando un amministratore
 * annulla a mano il cliente riprende anche i 3 € che i Termini dicevano di
 * trattenere. La promessa scritta e il comportamento reale andavano in due
 * direzioni diverse.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────
 * Non che una frase sia sparita: che il testo del §6 NASCA dal meccanismo. Si
 * esegue il generatore con i fatti di oggi e con i fatti di un domani in cui
 * l'esito esiste, e si guarda cosa esce. Se il meccanismo c'è, la clausola
 * della trattenuta torna da sé; se manca anche una sola delle tre gambe, il
 * testo dice la verità di oggi. È l'unico modo per cui una pagina legale resta
 * allineata al codice senza che nessuno se ne debba ricordare.
 */

const RADICE = resolve(__dirname, '..', '..');
const leggi = (f: string) => readFileSync(join(RADICE, f), 'utf8');
/** Solo quello che l'utente legge: i commenti raccontano il difetto, non lo ripetono. */
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TRATTENUTA = /al netto delle spese di consegna/i;
const TENTATIVI = /tre tentativi|3 tentativi|tentativi di contatto telefonico/i;

describe('oggi il codice non sa gestire il cliente assente, e i Termini lo dicono', () => {
  it('da «in consegna» il fattorino non ha nessun esito diverso da «consegnato»', () => {
    expect(esitiDelFattorinoInConsegna().filter((a) => a !== 'DELIVERED')).toEqual([]);
  });

  it('i tre fatti letti dal codice vero: nessun esito, nessun tentativo, rimborso intero', () => {
    const fatti = fattiDellaConsegna();
    expect(fatti.esitoDiMancataConsegna).toBe(false);
    expect(fatti.tentativiRegistrati).toBe(false);
    expect(fatti.rimborso).toBe('integrale');
    expect(siPuoPromettereLaTrattenuta(fatti)).toBe(false);
  });

  it('il §6 generato oggi non promette né i tentativi né la trattenuta', () => {
    const testo = paragrafiConsegne().join('\n');
    expect(testo).not.toMatch(TRATTENUTA);
    expect(testo).not.toMatch(TENTATIVI);
  });

  it('e dice invece quello che succede davvero: rimborso intero, spese comprese', () => {
    const testo = paragrafiConsegne().join('\n');
    expect(testo).toMatch(/rimborsato per intero/i);
    expect(testo).toMatch(/spese di consegna\s+comprese/i);
    // Il cliente deve sapere che l'ordine NON si chiude da solo: e' la parte che
    // gli fa perdere il venerdi' sera se non gliela diciamo.
    expect(testo).toMatch(/non si chiude da solo/i);
    expect(testo).toMatch(/contatti/i);
  });
});

describe('la promessa segue il meccanismo: se l’esito esiste, la clausola torna da sé', () => {
  const CON_ESITO: PassaggioDiStato[] = [
    { da: 'OUT_FOR_DELIVERY', a: 'CANCELED', chi: 'fattorino' },
  ];
  const STATI_CON_ESITO = ['NEW', 'DELIVERED', 'CANCELED', 'NON_CONSEGNATO'];

  it('tutte e tre le gambe: i Termini tornano a promettere tentativi e trattenuta', () => {
    const fatti = fattiDellaConsegna(CON_ESITO, STATI_CON_ESITO, true, 'al_netto_della_consegna');
    expect(siPuoPromettereLaTrattenuta(fatti)).toBe(true);
    const testo = paragrafiConsegne(fatti).join('\n');
    expect(testo).toMatch(TRATTENUTA);
    expect(testo).toMatch(TENTATIVI);
    // Se si trattiene, si deve poter mostrare la prova: e' la ragione per cui
    // la clausola non si poteva scrivere prima.
    expect(testo).toMatch(/registrati con data e ora/i);
  });

  it('due gambe su tre non bastano: senza la prova dei tentativi non si trattiene', () => {
    const fatti = fattiDellaConsegna(CON_ESITO, STATI_CON_ESITO, false, 'al_netto_della_consegna');
    expect(siPuoPromettereLaTrattenuta(fatti)).toBe(false);
    expect(paragrafiConsegne(fatti).join('\n')).not.toMatch(TRATTENUTA);
  });

  it('e senza il rimborso al netto nemmeno: il testo non promette una sottrazione che nessuno calcola', () => {
    const fatti = fattiDellaConsegna(CON_ESITO, STATI_CON_ESITO, true, 'integrale');
    expect(siPuoPromettereLaTrattenuta(fatti)).toBe(false);
    expect(paragrafiConsegne(fatti).join('\n')).not.toMatch(TRATTENUTA);
  });
});

describe('i tre meccanismi, letti dove vivono davvero', () => {
  it('nessuna tabella né colonna registra i tentativi di contatto', () => {
    // Questa riga cade il giorno in cui la colonna compare: e' il momento di
    // rimettere TENTATIVI_DI_CONTATTO_REGISTRATI a true e rileggere il §6.
    expect(leggi('lib/database.types.ts')).not.toMatch(
      /delivery_attempts?|contact_attempts?|tentativi_consegna|absent_at/i,
    );
  });

  it('l’annullamento restituisce il residuo INTERO, la quota di consegna compresa', () => {
    const annulla = leggi('lib/ordini/annulla.ts');
    expect(annulla).toMatch(/residuoCent\s*=\s*Math\.max\(0,\s*totaleCent\s*-\s*giaRimborsato\)/);
    // Nessuno scomputa la consegna. Quando qualcuno lo fara', questa riga cade.
    expect(senzaCommenti(annulla)).not.toMatch(/shipping_cost/);
  });
});

describe('la pagina non tiene una copia sua del §6', () => {
  const pagina = leggi('app/terms/page.tsx');

  it('il testo lo stampa il generatore, non una frase scritta a mano', () => {
    expect(pagina).toMatch(/paragrafiConsegne\(\)/);
    expect(pagina).toMatch(/from '@\/lib\/legal\/promessa-cliente-assente'/);
  });

  it('e la vecchia promessa non è rimasta da nessuna parte nella pagina', () => {
    const testo = senzaCommenti(pagina);
    expect(testo).not.toMatch(TRATTENUTA);
    expect(testo).not.toMatch(TENTATIVI);
  });
});

describe('e non è tornata in nessun’altra pagina che il cliente legge', () => {
  const CARTELLE = ['app', 'components'];
  const ESTENSIONI = /\.(tsx?|md)$/;

  function tuttiIFile(dir: string, dentro: string[] = []): string[] {
    for (const voce of readdirSync(join(RADICE, dir))) {
      if (voce === 'node_modules' || voce.startsWith('.')) continue;
      const rel = join(dir, voce);
      if (statSync(join(RADICE, rel)).isDirectory()) tuttiIFile(rel, dentro);
      else if (ESTENSIONI.test(voce)) dentro.push(rel);
    }
    return dentro;
  }

  it('«al netto delle spese di consegna» non compare in nessuna pagina', () => {
    const colpevoli = CARTELLE.flatMap((c) => tuttiIFile(c)).filter((f) =>
      TRATTENUTA.test(senzaCommenti(leggi(f))),
    );
    expect(colpevoli).toEqual([]);
  });
});
