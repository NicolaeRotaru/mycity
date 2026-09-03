import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GLI AVVISI NASCONO CON UNA CATEGORIA CHE IL DATABASE ACCETTA.
 *
 * 3/9/2026 — LA SEGNALAZIONE DI UN PRODOTTO PERICOLOSO NON AVVISAVA NESSUNO.
 *
 * Chi trova sul sito un prodotto contraffatto o pericoloso lo segnala dal
 * modulo pubblico. La segnalazione veniva salvata, ma la riga di avviso agli
 * amministratori nasceva con categoria «moderation», e il database ne ammette
 * cinque: order, promo, group, newsletter, system (migrazione 115). La
 * scrittura veniva rifiutata. Peggio: il codice non leggeva il campo `error`
 * che il client Supabase restituisce — e quel client non solleva eccezioni,
 * quindi il try/catch attorno non scattava. La rotta rispondeva «ricevuto» e
 * nessuno sapeva niente: la riga restava in tabella finche' qualcuno non apriva
 * a mano la pagina delle segnalazioni.
 *
 * LA CAUSA: la categoria era scritta a mano nella rotta invece di venire da un
 * elenco condiviso col vincolo del database. Un valore inventato non lo ferma
 * nessuno finche' non arriva al database — e li' fallisce in silenzio.
 *
 * QUESTA E' LA GUARDIA CHE CHIUDE LA CLASSE, non il singolo caso: legge
 * l'elenco ammesso DALLA MIGRAZIONE (una fonte sola) e lo confronta con ogni
 * categoria scritta nel codice che finisce sulla tabella degli avvisi. La
 * prossima categoria inventata diventa rossa qui, prima di arrivare in
 * produzione.
 */

const RADICE = join(__dirname, '..', '..');

/**
 * La gemella che ESEGUE la rotta e'
 * tests/unit/la-segnalazione-di-un-prodotto-pericoloso-avvisa-gli-amministratori.test.ts:
 * li' si controlla che il fallimento della scrittura non sparisca in silenzio,
 * qui che la categoria sia una di quelle che il database accetta.
 */

/** Chi scrive `category:` ma NON sulla tabella degli avvisi: sono altre tabelle, altri vincoli. */
const ALTRE_TABELLE: Record<string, string> = {
  // `activity_events.category` e' testo libero (migrazione 073, riga 21): il
  // registro di sorveglianza usa apposta un elenco piu' largo.
  'lib/audit.ts': 'activity_events',
};

function fileSorgente(dir: string, dentro: string[] = []): string[] {
  for (const voce of readdirSync(dir)) {
    if (voce === 'node_modules' || voce === '.next') continue;
    const percorso = join(dir, voce);
    if (statSync(percorso).isDirectory()) fileSorgente(percorso, dentro);
    else if (/\.tsx?$/.test(voce) && !/\.test\.tsx?$/.test(voce)) dentro.push(percorso);
  }
  return dentro;
}

/** L'elenco ammesso, letto dalla migrazione che lo scrive nel database. */
function categorieAmmesse(): string[] {
  const migrazione = readFileSync(join(RADICE, 'migrations', '115_privacy_radiografia.sql'), 'utf8');
  const vincolo = migrazione.match(/CHECK\s*\(category IN \(([^)]+)\)\)/i);
  if (!vincolo) throw new Error('Il vincolo sulle categorie non si trova piu nella migrazione 115');
  return [...vincolo[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

type Uso = { file: string; categoria: string; riga: number };

function categorieScritteNelCodice(): Uso[] {
  const usi: Uso[] = [];
  for (const cartella of ['app', 'lib']) {
    for (const percorso of fileSorgente(join(RADICE, cartella))) {
      const relativo = percorso.slice(RADICE.length + 1);
      if (ALTRE_TABELLE[relativo]) continue;
      const testo = readFileSync(percorso, 'utf8');
      if (!testo.includes("from('notifications')")) continue;
      testo.split('\n').forEach((riga, i) => {
        const trovato = riga.match(/category:\s*'([^']+)'/);
        if (trovato) usi.push({ file: relativo, categoria: trovato[1], riga: i + 1 });
      });
    }
  }
  return usi;
}

describe('la categoria di un avviso e una di quelle che il database accetta', () => {
  const ammesse = categorieAmmesse();
  const usi = categorieScritteNelCodice();

  it('l elenco ammesso si legge dalla migrazione, e sono cinque', () => {
    expect(ammesse).toEqual(['order', 'promo', 'group', 'newsletter', 'system']);
  });

  it('il codice scrive davvero delle categorie: la guardia non gira a vuoto', () => {
    expect(usi.length, 'nessuna categoria trovata: la scansione non sta guardando niente').toBeGreaterThan(10);
  });

  it('IL CASO CHE ROMPEVA — nessun avviso nasce con una categoria che il database rifiuta', () => {
    const rifiutate = usi.filter((u) => !ammesse.includes(u.categoria));
    const elenco = rifiutate.map((u) => `${u.file}:${u.riga} → «${u.categoria}»`);

    expect(
      elenco,
      'questi avvisi non arrivano a nessuno: il database rifiuta la riga e il codice non legge l errore',
    ).toEqual([]);
  });

  it('la segnalazione di un prodotto pericoloso usa la categoria che non si puo spegnere', () => {
    // «system» sono gli avvisi di servizio: la funzione vuole_notifica (115) li
    // lascia passare sempre. Una segnalazione non deve poter essere silenziata
    // dalle preferenze di un amministratore.
    const segnalazioni = usi.filter((u) => u.file === 'app/api/segnalazioni/route.ts');
    expect(segnalazioni.map((u) => u.categoria)).toEqual(['system']);
  });
});
