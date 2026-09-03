/**
 * Ricostruisce, leggendo SOLO i file in `migrations/`, chi potra' eseguire cosa
 * e chi potra' leggere cosa quando quelle migrazioni saranno applicate.
 *
 * PERCHE' ESISTE. Le migrazioni le applica una persona, a mano, sul database di
 * produzione: da una prova automatica non si puo' interrogare il catalogo vero.
 * Se l'unica prova fosse «ho scritto la revoca nel file», la prova sarebbe la
 * frase stessa. Qui invece si ricostruisce lo STATO FINALE — creazioni, revoche
 * e concessioni applicate in ordine, come le applicherebbe Postgres — e su
 * quello stato si fanno le domande.
 *
 * IL PRESUPPOSTO CHE CAMBIA TUTTO, ed e' misurato, non supposto: in questo
 * database un oggetto NASCE APERTO, e i permessi arrivano da DUE rubinetti
 * distinti che vanno chiusi tutti e due.
 *   · il rubinetto di Postgres: una funzione nasce con EXECUTE concesso a
 *     PUBLIC, cioe' a chiunque, `anon` compreso;
 *   · il rubinetto di Supabase: `ALTER DEFAULT PRIVILEGES` concede EXECUTE ad
 *     `anon` e ad `authenticated` per ogni funzione futura dello schema
 *     `public`, e SELECT per ogni vista futura.
 * Da qui i due errori che questo repo ha gia' commesso, tutti e due veri:
 *   · `REVOKE … FROM anon` senza PUBLIC — non chiude, perche' resta il primo
 *     rubinetto (documentato in tests/sql/rls/10, cinque volte in due file);
 *   · `REVOKE … FROM public` senza anon — non chiude, perche' resta il secondo
 *     (migrazione 114 riga 55 su `is_rider_approvato`: la funzione e' ancora
 *     in mano agli anonimi oggi, in produzione);
 *   · `GRANT SELECT … TO authenticated` creduto un divieto per gli altri — la
 *     porta era gia' aperta e nessuno l'ha chiusa (migrazione 127 riga 760 su
 *     `rider_consegne_storico`).
 * Per questo qui i rubinetti si contano separati: `pubblico`, `anon`,
 * `autenticato`. Un ruolo entra se ALMENO UNO e' aperto.
 *
 * NON e' un interprete di SQL: e' un lettore che copre i modi in cui QUESTO
 * repo scrive permessi. La sua fedelta' non e' un'opinione — il 3/9/2026 e'
 * stata confrontata col catalogo di un Postgres 16 su cui erano state applicate
 * tutte e 145 le migrazioni: stesse 19 funzioni potenti aperte agli anonimi,
 * stesse 8 viste con gli stessi permessi. Se un domani una migrazione usera'
 * una forma qui non prevista, il lettore la ignorerebbe e il guardiano
 * diventerebbe piu' permissivo senza dirlo: per questo `formeNonCapite`
 * elenca le righe di permesso che non ha saputo leggere, e il test pretende
 * che siano zero.
 */
import fs from 'node:fs';
import path from 'node:path';

/** I tre rubinetti da cui arriva un permesso. Aperto uno, il ruolo entra. */
type Rubinetti = { pubblico: boolean; anon: boolean; autenticato: boolean };

export type Funzione = {
  nome: string;
  /** Gira coi permessi di chi l'ha creata (SECURITY DEFINER). */
  potente: boolean;
  /**
   * Il corpo tiene conto di chi sta chiamando — direttamente (auth.uid(),
   * is_admin(), is_rider_approvato()) oppure chiamando un'altra funzione che
   * lo fa. La catena si segue fino in fondo: spostare il controllo dentro un
   * aiutante non deve far sparire il controllo agli occhi del guardiano, e
   * mettere un aiutante che NON controlla non deve farlo comparire.
   */
  controllaChiChiama: boolean;
  /** Il corpo scrive su una tabella. */
  scrive: boolean;
  anonPuoEseguire: boolean;
  autenticatoPuoEseguire: boolean;
  /** Da quale rubinetto passa l'anonimo: serve a scrivere una revoca che chiude davvero. */
  rubinettiAperti: string;
  /** File in cui la funzione compare l'ultima volta: serve ai messaggi d'errore. */
  ultimoFile: string;
};

export type Vista = {
  nome: string;
  /** Legge coi permessi di CHI INTERROGA (security_invoker = true). */
  usaPermessiDiChiLegge: boolean;
  anonPuoLeggere: boolean;
  autenticatoPuoLeggere: boolean;
  /** Funzioni potenti chiamate dentro il corpo: una vista che ne chiama una scavalca la RLS lo stesso. */
  funzioniPotentiDentro: string[];
  /** Il testo del SELECT: serve a guardare QUALI colonne finiscono in vetrina. */
  corpo: string;
  ultimoFile: string;
};

export type StatoPermessi = {
  funzioni: Map<string, Funzione>;
  viste: Map<string, Vista>;
  /** Righe GRANT/REVOKE che il lettore non ha saputo interpretare. */
  formeNonCapite: string[];
};

type FunzioneInterna = Omit<Funzione, 'anonPuoEseguire' | 'autenticatoPuoEseguire' | 'rubinettiAperti'> & {
  porta: Rubinetti;
  /** Il corpo, per ritrovare le funzioni che chiama. */
  corpo: string;
};
type VistaInterna = Omit<Vista, 'anonPuoLeggere' | 'autenticatoPuoLeggere'> & { porta: Rubinetti };

const CONTROLLI = /auth\.uid\s*\(|is_admin\s*\(|is_rider_approvato\s*\(|current_setting\s*\(\s*'request\.jwt/i;
const SCRITTURE = /\binsert\s+into\b|\bupdate\s+(?:public\.)?"?\w+"?\s+set\b|\bdelete\s+from\b/i;

/** Toglie i corpi con virgolette-dollaro e li mette da parte. */
function estraiCorpi(sql: string): { fuori: string; corpi: string[] } {
  const corpi: string[] = [];
  let fuori = '';
  let i = 0;
  while (i < sql.length) {
    const apre = /\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
    if (!apre) {
      fuori += sql.slice(i);
      break;
    }
    const inizio = i + (apre.index ?? 0);
    const tag = apre[0];
    fuori += sql.slice(i, inizio);
    const fine = sql.indexOf(tag, inizio + tag.length);
    if (fine === -1) {
      fuori += sql.slice(inizio); // virgoletta-dollaro senza chiusura: si tiene com'e'
      break;
    }
    corpi.push(sql.slice(inizio + tag.length, fine));
    fuori += ` @@CORPO${corpi.length - 1}@@ `;
    i = fine + tag.length;
  }
  return { fuori, corpi };
}

/** Via i commenti, che altrimenti sembrano istruzioni. */
function senzaCommenti(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function nomeNudo(riferimento: string): string {
  return riferimento
    .trim()
    .replace(/^public\./i, '')
    .replace(/^"|"$/g, '')
    .replace(/\s*\([\s\S]*$/, '') // via la firma degli argomenti
    .trim()
    .toLowerCase();
}

/** I ruoli citati dopo FROM/TO, normalizzati. */
function ruoli(elenco: string): string[] {
  return elenco
    .split(',')
    .map((r) => r.trim().replace(/[;'"]/g, '').toLowerCase())
    .filter(Boolean);
}

/** Apre o chiude i rubinetti citati da una riga GRANT/REVOKE. */
function muoviRubinetti(porta: Rubinetti, chi: string[], concede: boolean): void {
  if (chi.includes('public')) porta.pubblico = concede;
  if (chi.includes('anon')) porta.anon = concede;
  if (chi.includes('authenticated')) porta.autenticato = concede;
}

export function statoFinaleDeiPermessi(cartellaMigrazioni: string): StatoPermessi {
  const funzioni = new Map<string, FunzioneInterna>();
  const viste = new Map<string, VistaInterna>();
  const formeNonCapite: string[] = [];

  const file = fs
    .readdirSync(cartellaMigrazioni)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  for (const nomeFile of file) {
    const grezzo = fs.readFileSync(path.join(cartellaMigrazioni, nomeFile), 'utf8');
    const { fuori, corpi } = estraiCorpi(grezzo);
    const testo = senzaCommenti(fuori);
    const corpoDi = (s: string): string => s.replace(/@@CORPO(\d+)@@/g, (_m, n) => corpi[Number(n)] ?? '');

    for (const pezzo of testo.split(';')) {
      const istruzione = pezzo.replace(/\s+/g, ' ').trim();
      if (!istruzione) continue;

      // ── CREATE FUNCTION ────────────────────────────────────────────────
      const creaFn = /^create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/i.exec(istruzione);
      if (creaFn) {
        const nome = creaFn[1].toLowerCase();
        const corpo = corpoDi(istruzione);
        const gia = funzioni.get(nome);
        funzioni.set(nome, {
          nome,
          potente: /security\s+definer/i.test(istruzione),
          controllaChiChiama: CONTROLLI.test(corpo),
          scrive: SCRITTURE.test(corpo),
          // CREATE OR REPLACE non tocca i permessi gia' dati: se la funzione
          // c'era restano quelli, se nasce adesso nasce aperta (vedi in cima).
          porta: gia ? gia.porta : { pubblico: true, anon: true, autenticato: true },
          corpo,
          ultimoFile: nomeFile,
        });
        continue;
      }

      const togliFn = /^drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/i.exec(istruzione);
      if (togliFn) {
        funzioni.delete(togliFn[1].toLowerCase());
        continue;
      }

      // ── CREATE VIEW ────────────────────────────────────────────────────
      const creaVista =
        /^create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?"?(\w+)"?([\s\S]*?)\bas\b([\s\S]*)$/i.exec(istruzione);
      if (creaVista) {
        const nome = creaVista[1].toLowerCase();
        const opzioni = creaVista[2] ?? '';
        const corpo = corpoDi(creaVista[3] ?? '');
        const gia = viste.get(nome);
        viste.set(nome, {
          nome,
          usaPermessiDiChiLegge: /security_invoker\s*=\s*(true|on)/i.test(opzioni),
          // una vista non nasce concessa a PUBLIC, ma nasce concessa ad `anon`
          // e ad `authenticated` per via dei privilegi di default di Supabase
          porta: gia ? gia.porta : { pubblico: false, anon: true, autenticato: true },
          funzioniPotentiDentro: [...funzioni.values()]
            .filter((f) => f.potente && new RegExp(`\\b${f.nome}\\s*\\(`, 'i').test(corpo))
            .map((f) => f.nome),
          corpo,
          ultimoFile: nomeFile,
        });
        continue;
      }

      const togliVista = /^drop\s+view\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/i.exec(istruzione);
      if (togliVista) {
        viste.delete(togliVista[1].toLowerCase());
        continue;
      }

      const alteraVista =
        /^alter\s+view\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?\s+set\s*\(([^)]*)\)/i.exec(istruzione);
      if (alteraVista) {
        const v = viste.get(alteraVista[1].toLowerCase());
        const scelta = /security_invoker\s*=\s*(true|on|false|off)/i.exec(alteraVista[2]);
        // La 121 rimette `= off` su una vista che la 048 aveva messo a `on`:
        // leggere solo l'accensione darebbe per sicura una vista che non lo e'.
        if (v && scelta) v.usaPermessiDiChiLegge = /^(true|on)$/i.test(scelta[1]);
        continue;
      }

      // ── DO $$ … $$ : revoche e concessioni scritte dentro un ciclo ──────
      if (/^do\s+@@CORPO\d+@@/i.test(istruzione)) {
        applicaBloccoDinamico(corpoDi(istruzione), funzioni, viste);
        continue;
      }

      // ── GRANT / REVOKE ─────────────────────────────────────────────────
      if (/^(grant|revoke)\b/i.test(istruzione)) {
        if (!applicaPermesso(istruzione, funzioni, viste)) {
          formeNonCapite.push(`${nomeFile}: ${istruzione.slice(0, 120)}`);
        }
        continue;
      }
    }
  }

  seguiLaCatenaDeiControlli(funzioni);

  return {
    funzioni: new Map(
      [...funzioni].map(([nome, f]) => [
        nome,
        {
          nome: f.nome,
          potente: f.potente,
          controllaChiChiama: f.controllaChiChiama,
          scrive: f.scrive,
          anonPuoEseguire: f.porta.pubblico || f.porta.anon,
          autenticatoPuoEseguire: f.porta.pubblico || f.porta.autenticato,
          rubinettiAperti: [f.porta.pubblico && 'PUBLIC', f.porta.anon && 'anon']
            .filter(Boolean)
            .join(' + ') || 'nessuno',
          ultimoFile: f.ultimoFile,
        },
      ]),
    ),
    viste: new Map(
      [...viste].map(([nome, v]) => [
        nome,
        {
          nome: v.nome,
          usaPermessiDiChiLegge: v.usaPermessiDiChiLegge,
          anonPuoLeggere: v.porta.pubblico || v.porta.anon,
          autenticatoPuoLeggere: v.porta.pubblico || v.porta.autenticato,
          funzioniPotentiDentro: v.funzioniPotentiDentro,
          corpo: v.corpo,
          ultimoFile: v.ultimoFile,
        },
      ]),
    ),
    formeNonCapite,
  };
}

/**
 * Un controllo spostato dentro un aiutante resta un controllo. Qui si propaga
 * `controllaChiChiama` da chi guarda l'identita' a chi lo chiama, ripetendo il
 * giro finche' non cambia piu' niente (le catene sono corte, ma i cicli
 * esistono e il punto fisso li regge).
 */
function seguiLaCatenaDeiControlli(funzioni: Map<string, FunzioneInterna>): void {
  const nomi = [...funzioni.keys()];
  for (let giro = 0; giro < nomi.length; giro++) {
    let cambiato = false;
    for (const f of funzioni.values()) {
      if (f.controllaChiChiama) continue;
      for (const altro of nomi) {
        if (altro === f.nome) continue;
        const chiamata = funzioni.get(altro);
        if (!chiamata?.controllaChiChiama) continue;
        if (new RegExp(`\\b${altro}\\s*\\(`, 'i').test(f.corpo)) {
          f.controllaChiChiama = true;
          cambiato = true;
          break;
        }
      }
    }
    if (!cambiato) return;
  }
}

/** Applica una riga GRANT/REVOKE. Torna false se non l'ha capita. */
function applicaPermesso(
  istruzione: string,
  funzioni: Map<string, FunzioneInterna>,
  viste: Map<string, VistaInterna>,
): boolean {
  const concede = /^grant\b/i.test(istruzione);

  // GRANT/REVOKE … ON FUNCTION a, b FROM|TO ruoli
  const suFunzione = /\bon\s+function\s+([\s\S]*?)\s+(?:from|to)\s+([\w\s,"]+)$/i.exec(istruzione);
  if (suFunzione) {
    if (!/\b(execute|all)\b/i.test(istruzione.slice(0, suFunzione.index))) return true;
    const chi = ruoli(suFunzione[2]);
    for (const rif of suFunzione[1].split(/,(?![^(]*\))/)) {
      const f = funzioni.get(nomeNudo(rif));
      if (f) muoviRubinetti(f.porta, chi, concede);
    }
    return true;
  }

  // GRANT/REVOKE … ON [TABLE] a, b FROM|TO ruoli  (le viste stanno qui)
  const suTabella = /\bon\s+(?:table\s+)?([\s\S]*?)\s+(?:from|to)\s+([\w\s,"]+)$/i.exec(istruzione);
  if (suTabella) {
    if (!/\b(select|all)\b/i.test(istruzione.slice(0, suTabella.index))) return true;
    const chi = ruoli(suTabella[2]);
    for (const rif of suTabella[1].split(',')) {
      const v = viste.get(nomeNudo(rif));
      if (v) muoviRubinetti(v.porta, chi, concede);
    }
    return true;
  }

  // GRANT USAGE su schemi e sequenze: non riguarda ne' funzioni ne' viste.
  if (/^grant\s+usage\b/i.test(istruzione)) return true;
  return false;
}

/**
 * Un blocco DO che scrive permessi con `format()` su un elenco di nomi.
 * Nel repo la forma e' sempre la stessa: i nomi stanno in stringhe dentro il
 * blocco — `proname IN ('a','b')` oppure `ARRAY['a()','b(uuid)']` — oppure il
 * ciclo gira su «tutte le viste» (`relkind = 'v'`).
 */
function applicaBloccoDinamico(
  corpo: string,
  funzioni: Map<string, FunzioneInterna>,
  viste: Map<string, VistaInterna>,
): void {
  const nomiCitati = [...corpo.matchAll(/'([a-z_][a-z0-9_]{2,})\s*(?:\([^']*\))?'/gi)].map((m) =>
    m[1].toLowerCase(),
  );
  const tutteLeViste = /relkind\s*=\s*'v'/i.test(corpo);

  for (const riga of corpo.split('\n')) {
    const m = /\b(grant|revoke)\b([\s\S]*?)\bon\b([\s\S]*?)\b(?:from|to)\s+([\w\s,%I']+)/i.exec(riga);
    if (!m) continue;
    const concede = m[1].toLowerCase() === 'grant';
    const permessi = m[2];
    const bersaglio = m[3];
    const chi = ruoli(m[4]);

    if (/\bfunction\b/i.test(bersaglio)) {
      if (!/\b(execute|all)\b/i.test(permessi)) continue;
      for (const nome of nomiCitati) {
        const f = funzioni.get(nome);
        if (f) muoviRubinetti(f.porta, chi, concede);
      }
      continue;
    }
    if (/\b(select|all)\b/i.test(permessi)) {
      for (const nome of tutteLeViste ? [...viste.keys()] : nomiCitati) {
        const v = viste.get(nome);
        if (v) muoviRubinetti(v.porta, chi, concede);
      }
    }
  }
}
