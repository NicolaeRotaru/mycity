/**
 * IL REGISTRO ATTIVITA' SI COPIAVA IL COGNOME LEGALE, E NESSUNO L'AVEVA MAI
 * CONTROLLATO.
 *
 * Il trigger `log_activity_change` scrive in `activity_events.metadata.changed`
 * il valore vecchio e quello nuovo di ogni colonna cambiata, e oscura solo
 * quelle il cui NOME somiglia a una lista scritta a mano. La lista aveva
 * `full_name`, `nome`, `cognome` — e non aveva `first_name` ne' `last_name`.
 * Cosi' `profiles.legal_first_name` e `profiles.legal_last_name` — l'identita'
 * legale usata per la verifica di negozianti e fattorini — finivano nel
 * registro in chiaro, e ci restavano quattordici mesi anche dopo la
 * cancellazione dell'account.
 *
 * ── COSA ESEGUE QUESTA PROVA ──
 *
 * La regola vera vive nel database, dentro `activity_key_sensibile`. Qui non
 * c'e' un database, quindi la regola si legge DAL FILE DI MIGRAZIONE — cioe'
 * dal testo che verra' eseguito in produzione — e si esegue su un elenco di
 * colonne vere. Non si cerca una parola nel sorgente: si compila l'espressione
 * e le si chiede, colonna per colonna, «questo valore lo mostri o lo oscuri?».
 *
 * Le tre domande sono:
 *  ① ogni colonna personale dello schema viene oscurata;
 *  ② le colonne che a un registro servono davvero (stati, prezzi, date) NON
 *    vengono oscurate — una regola che oscura tutto e' inutile quanto una che
 *    non oscura niente;
 *  ③ una colonna INVENTATA, che nello schema ancora non esiste, nasce oscurata.
 *    E' la domanda che chiude la malattia: finche' la risposta e' «si'», la
 *    prossima colonna personale non nasce piu' in chiaro.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  COLONNE_PERMESSE_NEL_DIFF,
  COLONNE_SEMPRE_SENSIBILI,
  COLONNE_PERSONALI,
  COLONNE_DA_MOSTRARE,
} from '@/lib/privacy/colonne-personali';

const CARTELLA_MIGRAZIONI = join(process.cwd(), 'migrations');

/**
 * L'ultima migrazione che (ri)definisce la funzione: e' quella che comanda nel
 * database, perche' le migrazioni si applicano in ordine di numero.
 */
function ultimaDefinizione(): { file: string; sql: string } {
  const file = readdirSync(CARTELLA_MIGRAZIONI)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => readFileSync(join(CARTELLA_MIGRAZIONI, f), 'utf8')
      .includes('CREATE OR REPLACE FUNCTION public.activity_key_sensibile'))
    .sort()
    .pop();
  if (!file) throw new Error('nessuna migrazione definisce activity_key_sensibile');
  return { file, sql: readFileSync(join(CARTELLA_MIGRAZIONI, file), 'utf8') };
}

/** Il corpo della funzione, senza i commenti: li' dentro ci sono i rollback. */
function corpoDellaFunzione(sql: string): string {
  const da = sql.indexOf('CREATE OR REPLACE FUNCTION public.activity_key_sensibile');
  const corpo = sql.slice(da);
  return corpo
    .split('\n')
    .filter((riga) => !riga.trimStart().startsWith('--'))
    .join('\n');
}

/** Le espressioni passate a `~*`, nell'ordine in cui il database le valuta. */
function regoleDalSql(sql: string): string[] {
  return [...corpoDellaFunzione(sql).matchAll(/~\*\s*'([^']*)'/g)].map((m) => m[1]);
}

const { file, sql } = ultimaDefinizione();
const regole = regoleDalSql(sql);

/**
 * L'espressione della funzione, valutata come la valuta il database.
 *
 * Non si riscrive qui la composizione delle due regole: la si LEGGE. Al primo
 * tentativo questa prova teneva in casa il proprio `!permesse || veto`, e
 * togliendo il `NOT` dalla migrazione restava verde — cioe' non stava provando
 * la regola vera, ne stava provando una sua copia. Adesso `NOT`, `OR`, `AND` e
 * le parentesi arrivano dal file SQL: se qualcuno le cambia, qui si vede.
 *
 * `p_key` non e' mai nullo (arriva da `jsonb_object_keys`), quindi la logica a
 * due valori basta: niente terzo stato da imitare.
 */
function valutaEspressioneSql(sql: string, chiave: string): boolean {
  const corpo = corpoDellaFunzione(sql);
  const dentro = corpo.slice(corpo.indexOf('SELECT') + 'SELECT'.length, corpo.indexOf(';'));
  const pezzi = [...dentro.matchAll(/NOT|AND|OR|\(|\)|p_key\s*~\*\s*'(?:[^']*)'/gi)]
    .map((m) => m[0]);
  let i = 0;
  const guarda = () => pezzi[i];
  const prendi = () => pezzi[i++];

  const primaria = (): boolean => {
    const t = prendi();
    if (t === '(') {
      const v = espressione();
      if (prendi() !== ')') throw new Error('parentesi non chiusa nella funzione SQL');
      return v;
    }
    const regex = /'([^']*)'/.exec(t ?? '');
    if (!regex) throw new Error(`pezzo di SQL che questa prova non sa valutare: ${t}`);
    return new RegExp(regex[1], 'i').test(chiave);
  };
  const unaria = (): boolean => (guarda()?.toUpperCase() === 'NOT' ? (prendi(), !unaria()) : primaria());
  const congiunzione = (): boolean => {
    let v = unaria();
    while (guarda()?.toUpperCase() === 'AND') { prendi(); v = unaria() && v; }
    return v;
  };
  function espressione(): boolean {
    let v = congiunzione();
    while (guarda()?.toUpperCase() === 'OR') { prendi(); v = congiunzione() || v; }
    return v;
  }

  const valore = espressione();
  if (i !== pezzi.length) throw new Error('la funzione SQL ha una forma che questa prova non copre per intero');
  return valore;
}

/** La regola come la esegue il database, letta dal file che finira' in produzione. */
function oscuraSecondoIlDatabase(chiave: string): boolean {
  return valutaEspressioneSql(sql, chiave);
}

describe(`la regola di oscuramento del registro attivita' (${file})`, () => {
  it('la migrazione porta le due regole: l elenco chiuso e il veto', () => {
    expect(
      regole.length,
      'la funzione nel database non ha piu la forma «elenco chiuso + veto»: la prova qui sotto non starebbe eseguendo la regola vera',
    ).toBe(2);
  });

  it('le due regole nel database sono le stesse di lib/privacy/colonne-personali.ts', () => {
    // Due copie della stessa decisione: se si allontanano, il file TypeScript
    // racconta una regola e il database ne applica un'altra. E' il modo in cui
    // una promessa smette di essere vera senza che nessuno lo scelga.
    expect(regole[0]).toBe(COLONNE_PERMESSE_NEL_DIFF);
    expect(regole[1]).toBe(COLONNE_SEMPRE_SENSIBILI);
  });

  it('IL CASO CHE ROMPEVA — il cognome legale non finisce nel registro', () => {
    expect(
      oscuraSecondoIlDatabase('legal_last_name'),
      'il cognome legale di un fattorino resta leggibile nel registro per 14 mesi, anche dopo la cancellazione dell account',
    ).toBe(true);
    expect(oscuraSecondoIlDatabase('legal_first_name')).toBe(true);
  });

  it('e nemmeno il nome di chi riceve un buono regalo, o il messaggio che gli hanno scritto', () => {
    // Persone che con noi non hanno nessun rapporto: non hanno un account, non
    // hanno comprato, spesso non sanno nemmeno che esistiamo.
    expect(oscuraSecondoIlDatabase('recipient_name')).toBe(true);
    expect(oscuraSecondoIlDatabase('recipient_email')).toBe(true);
    expect(oscuraSecondoIlDatabase('message')).toBe(true);
  });

  it('ogni colonna personale dello schema viene oscurata, una per una', () => {
    const scoperte = COLONNE_PERSONALI.filter((c) => !oscuraSecondoIlDatabase(c));
    expect(
      scoperte,
      `queste colonne personali finiscono in chiaro nel registro attivita: ${scoperte.join(', ')}`,
    ).toEqual([]);
  });

  it('ma le colonne che a un registro servono restano leggibili', () => {
    // L'altro modo di sbagliare: una regola che oscura tutto trasforma il
    // registro in una fila di «***» e non serve piu' a niente. Chi indaga su un
    // ordine deve poter vedere che lo stato e passato da «pagato» a «annullato».
    const nascoste = COLONNE_DA_MOSTRARE.filter((c) => oscuraSecondoIlDatabase(c));
    expect(
      nascoste,
      `il registro non mostra piu nemmeno queste, che non dicono niente di nessuno: ${nascoste.join(', ')}`,
    ).toEqual([]);
  });

  it('LA MALATTIA — una colonna che ancora non esiste nasce oscurata', () => {
    // Con l'elenco di cose da nascondere, ogni colonna nuova nasceva in chiaro:
    // e' cosi' che `legal_first_name` e' rimasto scoperto per mesi. Rovesciata
    // la regola, il caso peggiore diventa «abbiamo nascosto un dato che
    // potevamo mostrare».
    for (const inventata of ['codice_destinatario_2', 'nickname_pubblico', 'contatto_urgenza']) {
      expect(
        oscuraSecondoIlDatabase(inventata),
        `«${inventata}» non esiste ancora nello schema e nascerebbe in chiaro: la malattia e ancora aperta`,
      ).toBe(true);
    }
  });
});
