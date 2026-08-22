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

  it('se il client installato non è quello atteso, il lavoro si ferma', () => {
    // Senza questo controllo un cambio di pacchetti passerebbe inosservato
    // fino alla prima volta che serve davvero una copia.
    expect(workflow).toContain('pg_dump --version');
    expect(workflow).toMatch(/::error::pg_dump non e' la versione/);
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
