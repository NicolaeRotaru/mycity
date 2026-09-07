/**
 * 22/8/2026 — LA COPIA NOTTURNA DEI DATI ERA GIA' ROTTA, E NON LO SAPEVA
 * NESSUNO.
 *
 * `pg_dump` è il programma che fa la copia del database. Si rifiuta di
 * lavorare quando il server è più recente di lui: è una regola sua, non
 * un'opinione.
 *
 * Il lavoro notturno installava «qualunque versione ci sia nei pacchetti del
 * computer di turno», che su Ubuntu 24.04 è la 16. Il database di produzione,
 * controllato il 22/8/2026 con lo strumento di Supabase, gira la 17. Quindi la
 * copia non partiva. E non partiva di notte, dove non guarda nessuno.
 *
 * Queste prove diventano rosse se il numero di versione sparisce dal lavoro, o
 * se il documento del ripristino torna a contraddirsi.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const leggi = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('il lavoro che copia il database ogni notte', () => {
  const workflow = leggi('.github/workflows/backup-db.yml');

  it('installa una versione precisa del client, non «quella che capita»', () => {
    expect(workflow).not.toMatch(/install -y[^\n]*postgresql-client\s*$/m);
    expect(workflow).toMatch(/postgresql-client-\$\{VERSIONE_ATTESA\}/);
  });

  it('la versione attesa è scritta, ed è quella della produzione', () => {
    const versioni = [...workflow.matchAll(/VERSIONE_ATTESA:\s*"(\d+)"/g)].map((m) => m[1]);
    // Due passi copiano (i dati e gli utenti): tutti e due la dichiarano.
    expect(versioni.length).toBeGreaterThanOrEqual(2);
    expect(new Set(versioni).size, 'i due passi dichiarano versioni diverse').toBe(1);
    expect(versioni[0]).toBe('17');
  });

  it('mette la versione giusta davanti nel percorso, prima di controllarla', () => {
    // 7/9/2026 — IL DIFETTO VERO, TROVATO GUARDANDO LE CORSE: il pacchetto si installava
    // benissimo, ma `pg_dump` chiamato per nome restava la 16. Il computer di turno porta
    // gia' PostgreSQL 16 e la cartella dei suoi binari viene prima nel percorso di ricerca.
    // Ventuno corse dal 19 agosto, ventuno fallite sulla riga del controllo di versione.
    const passi = workflow.split('- name: Installa il client Postgres').slice(1);
    expect(passi.length, 'i passi che installano il client sono due: copia e prova di ripristino').toBe(2);
    for (const passo of passi) {
      const iPercorso = passo.indexOf('/usr/lib/postgresql/${VERSIONE_ATTESA}/bin');
      const iControllo = passo.indexOf('pg_dump --version');
      expect(iPercorso, 'la cartella della versione attesa non finisce nel percorso').toBeGreaterThan(-1);
      expect(iPercorso, 'il percorso va sistemato PRIMA di controllare la versione').toBeLessThan(iControllo);
      // I passi successivi sono processi nuovi: senza questa riga ritrovano la 16.
      expect(passo.slice(0, iControllo)).toContain('>> "$GITHUB_PATH"');
    }
  });

  it('se il client installato non è quello atteso, il lavoro si ferma', () => {
    // Senza questo controllo un cambio di pacchetti passerebbe inosservato
    // fino alla prima volta che serve davvero una copia.
    expect(workflow).toContain('pg_dump --version');
    expect(workflow).toMatch(/::error::pg_dump non e' la versione/);
  });
});

describe('il controllo sulla forma dell\'indirizzo del database', () => {
  // 7/9/2026 — La prima corsa con le chiavi collegate è morta dicendo «connection to server on
  // socket /var/run/postgresql/... failed»: sembra un database locale rotto, ed è invece pg_dump
  // che, non riconoscendo un indirizzo, prende l'ultimo argomento come NOME del database.
  // Il messaggio mandava a cercare il guasto dalla parte sbagliata.
  //
  // Questa prova non cerca una parola nel file: ESEGUE il pezzo di shell vero, preso dal lavoro,
  // e gli dà i valori che una persona può incollare per sbaglio.
  const workflow = leggi('.github/workflows/backup-db.yml');

  // Se il controllo sparisce dal lavoro, `blocco` resta null e ogni prova qui sotto fallisce
  // dicendo perché — invece di far saltare la lettura dell'intero file.
  const blocco: string | null = (() => {
    const i = workflow.indexOf('case "$SUPABASE_DB_URL" in');
    if (i < 0) return null;
    const j = workflow.indexOf('esac', i);
    if (j < 0) return null;
    // Le righe del YAML sono indentate: le riporto a filo per darle a bash.
    return workflow.slice(i, j + 4).split('\n').map((r) => r.replace(/^ {10}/, '')).join('\n');
  })();

  const provaCon = (valore: string) => {
    expect(blocco, 'il controllo della forma non c\'è più nel lavoro: nessuno ferma un valore incollato male').not.toBeNull();
    return spawnSync('bash', ['-c', blocco as string], {
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_DB_URL: valore },
    });
  };

  it('lascia passare un indirizzo vero', () => {
    for (const buono of [
      'postgresql://postgres:segreta@db.abcdefgh.supabase.co:5432/postgres',
      'postgres://postgres:segreta@db.abcdefgh.supabase.co:5432/postgres',
    ]) {
      expect(provaCon(buono).status, `bocciato un indirizzo valido: ${buono}`).toBe(0);
    }
  });

  it('ferma i quattro modi in cui si sbaglia a incollarlo', () => {
    const sbagliati = [
      'psql "postgresql://postgres:segreta@db.abcdefgh.supabase.co:5432/postgres"', // il comando intero
      '"postgresql://postgres:segreta@db.abcdefgh.supabase.co:5432/postgres"', // con le virgolette
      ' postgresql://postgres:segreta@db.abcdefgh.supabase.co:5432/postgres', // uno spazio davanti
      'https://abcdefgh.supabase.co', // l'indirizzo del progetto, non del database
    ];
    for (const brutto of sbagliati) {
      const r = provaCon(brutto);
      expect(r.status, `lasciato passare un valore che pg_dump non capirebbe: ${brutto}`).not.toBe(0);
      expect(r.stdout + r.stderr).toContain('deve cominciare con postgresql://');
    }
  });

  it('non stampa mai il valore del segreto', () => {
    const r = provaCon('valore-segretissimo-da-non-stampare');
    expect(r.stdout + r.stderr).not.toContain('valore-segretissimo-da-non-stampare');
  });
});

describe('il documento su come si ripristinano i dati', () => {
  const doc = leggi('docs/backup-restore.md');

  it('non promette il ripristino al minuto sul piano gratuito', () => {
    const sezione = doc.slice(doc.indexOf('### Free tier'), doc.indexOf('### Pro tier'));
    expect(sezione).toContain('Nessun ripristino al minuto');
    expect(sezione).not.toMatch(/^- PITR a granularità/m);
  });

  it('l\'avviso in cima e la sezione sotto dicono la stessa cosa', () => {
    // Il difetto era esattamente questo: due righe che si escludono a vicenda,
    // nello stesso file, sul punto che conta di più.
    const avviso = doc.slice(0, doc.indexOf('## TL;DR'));
    expect(avviso).toContain('il ripristino al minuto non c\'è');
    const sezione = doc.slice(doc.indexOf('### Free tier'), doc.indexOf('### Pro tier'));
    expect(sezione).toContain('Nessun ripristino al minuto');
  });
});
