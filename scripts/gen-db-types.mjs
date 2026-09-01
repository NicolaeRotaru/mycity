#!/usr/bin/env node
/**
 * Genera lib/database.types.ts parsando le migrazioni SQL.
 *
 * Sostituto offline di `supabase gen types typescript` (che richiede DB
 * access). La fonte di verità sono migrations/*.sql applicate in ordine.
 *
 * Gestisce:
 *  - CREATE TABLE [IF NOT EXISTS] public.X (...)
 *  - ALTER TABLE [IF EXISTS] public.X ADD COLUMN [IF NOT EXISTS] col type
 *  - DROP TABLE [IF EXISTS] public.X
 *  - ALTER TABLE [IF EXISTS] public.X DROP COLUMN [IF EXISTS] col (anche multipli)
 *  - mapping tipi SQL → TS
 *  - nullable inference (NOT NULL / PRIMARY KEY → non-null; altrimenti null)
 *
 * CAVEAT: riflette lo schema delle migrations, non eventuali modifiche
 * manuali fatte via dashboard Supabase. Rigenerare dopo nuove migrations:
 *   node scripts/gen-db-types.mjs
 *
 * Uso: node scripts/gen-db-types.mjs
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'migrations');
const OUT = join(ROOT, 'lib', 'database.types.ts');

/** Mappa tipo SQL → tipo TS. */
function sqlTypeToTs(sqlType) {
  const t = sqlType.toLowerCase().trim();
  if (/^(uuid|text|varchar|char|citext|bpchar|name|date|timestamptz|timestamp|time|inet|interval)/.test(t)) return 'string';
  if (/^(numeric|decimal|real|double|float|int|integer|bigint|smallint|serial|bigserial)/.test(t)) return 'number';
  if (/^bool/.test(t)) return 'boolean';
  if (/^(jsonb|json)/.test(t)) return 'Json';
  if (/\[\]$/.test(t) || /^_/.test(t)) {
    const base = sqlTypeToTs(t.replace(/\[\]$/, ''));
    return `${base}[]`;
  }
  return 'Json'; // fallback sicuro per tipi custom (enum, ecc)
}

/** Estrae il nome colonna + tipo + nullable da una riga di definizione. */
function parseColumnLine(line) {
  // 22/8/2026 — LE COLONNE SCRITTE SU PIU' RIGHE SPARIVANO, IN SILENZIO.
  //
  // La riga qui sotto confronta con un'espressione che NON attraversa gli a
  // capo: una colonna dichiarata cosi'
  //
  //     ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'order'
  //       CHECK (category IN ('order', 'promo', …))
  //
  // non veniva riconosciuta affatto, e finiva fuori dai tipi senza che niente
  // lo dicesse. E' successo davvero a `notifications.category`, che il codice
  // usa in cinque punti: secondo i tipi generati non esisteva.
  //
  // E' la stessa famiglia del difetto #4 (le colonne in fila nella stessa
  // istruzione): un generatore che perde pezzi in silenzio rende i tipi una
  // rete con dei buchi, e una rete con dei buchi e' peggio di nessuna rete —
  // perche' ci si appoggia.
  //
  // Gli a capo diventano spazi prima di guardare.
  const cleaned = line.trim().replace(/\s+/g, ' ').replace(/,$/, '');
  // Skip constraint lines
  if (/^(constraint|primary key|foreign key|unique|check|exclude)\b/i.test(cleaned)) return null;
  const m = cleaned.match(/^"?([a-z_][a-z0-9_]*)"?\s+(.+)$/i);
  if (!m) return null;
  const name = m[1];
  const rest = m[2];
  // Tipo = prima parola(/e) prima di un modifier. Gestisce numeric(10,2), text[], ecc.
  const typeMatch = rest.match(/^([a-z_]+(?:\s*\([0-9, ]*\))?(?:\s*\[\])?)/i);
  if (!typeMatch) return null;
  let sqlType = typeMatch[1].replace(/\s*\([0-9, ]*\)/, ''); // rimuove precision
  const upper = rest.toUpperCase();
  const notNull = /\bNOT NULL\b/.test(upper) || /\bPRIMARY KEY\b/.test(upper);
  const hasDefault = /\bDEFAULT\b/.test(upper);
  // nullable se non NOT NULL; ma se ha DEFAULT NOT NULL conta come non-null
  const nullable = !notNull;
  return { name, tsType: sqlTypeToTs(sqlType), nullable, hasDefault };
}

/**
 * 31/8/2026 — IL GENERATORE ESEGUIVA I COMMENTI.
 *
 * In questa casa una migrazione documenta come si torna indietro, e lo fa in un
 * commento. La 148 scrive:
 *     -- REVERSIBILE: `ALTER TABLE public.abandoned_carts DROP COLUMN recovered_at;`
 * Il generatore non toglieva i commenti, quindi quella riga la leggeva come
 * codice: aggiungeva `recovered_at` (dall'ALTER vero) e subito dopo la
 * cancellava (dal commento). Nei tipi la colonna spariva, senza un errore, senza
 * una riga di avviso — e il file committato non combaciava piu' con le
 * migrazioni, che e' esattamente cio' che il lavoro «I tipi del database sono
 * aggiornati» in CI e' li' per prendere.
 *
 * Piu' e' buona l'abitudine di documentare il rollback, piu' colonne sparivano.
 *
 * Si tolgono i commenti PRIMA di leggere, rispettando le virgolette: un `--`
 * dentro una stringa (o dentro un corpo di funzione fra `$$`) e' testo, non un
 * commento, e cancellarlo cambierebbe il significato del codice vero.
 */
export function senzaCommenti(sql) {
  let fuori = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const due = sql.slice(i, i + 2);

    if (c === "'") {                                    // stringa: si copia intera
      const fine = sql.indexOf("'", i + 1);
      if (fine === -1) { fuori += sql.slice(i); break; }
      fuori += sql.slice(i, fine + 1); i = fine + 1; continue;
    }
    const dollaro = sql.slice(i).match(/^\$([a-z_]*)\$/i);  // corpo di funzione $$ … $$
    if (dollaro) {
      const tag = dollaro[0];
      const fine = sql.indexOf(tag, i + tag.length);
      if (fine === -1) { fuori += sql.slice(i); break; }
      fuori += sql.slice(i, fine + tag.length); i = fine + tag.length; continue;
    }
    if (due === '--') {                                 // commento di riga: via
      const fine = sql.indexOf('\n', i);
      if (fine === -1) break;
      fuori += '\n'; i = fine + 1; continue;
    }
    if (due === '/*') {                                 // commento a blocco: via
      const fine = sql.indexOf('*/', i + 2);
      if (fine === -1) break;
      fuori += ' '; i = fine + 2; continue;
    }
    fuori += c; i += 1;
  }
  return fuori;
}

/** Parsing principale. */
function buildSchema() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  /** @type {Record<string, Record<string, {tsType:string,nullable:boolean,hasDefault:boolean}>>} */
  const tables = {};

  for (const file of files) {
    const sql = senzaCommenti(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));

    // --- CREATE TABLE blocks ---
    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
    let m;
    while ((m = createRe.exec(sql)) !== null) {
      const table = m[1];
      const body = m[2];
      if (!tables[table]) tables[table] = {};
      // Split su righe (le constraint multi-linea sono raramente colonne)
      const lines = body.split('\n');
      for (const line of lines) {
        const col = parseColumnLine(line);
        if (col) tables[table][col.name] = { tsType: col.tsType, nullable: col.nullable, hasDefault: col.hasDefault };
      }
    }

    // --- ALTER TABLE ADD COLUMN ---
    //
    // #4 — QUI IL GENERATORE PERDEVA LE COLONNE, E IN SILENZIO.
    //
    // La regola di prima leggeva «alter table X add column Y ...» e si
    // fermava lì: una sola colonna per istruzione. Ma in SQL si scrive
    // benissimo `alter table orders add column a …, add column b …,
    // add column c …`, ed è come sono nate le colonne dei soldi nella
    // migrazione 024: `seller_payout_cents` era la settima della fila, quindi
    // nei tipi non compariva affatto. Stessa sorte per `kyc_selfie_url`.
    //
    // Non dava nessun errore: il file si generava, il test guardava solo i
    // nomi delle tabelle, e nel frattempo cinque file di codice nominavano una
    // colonna che secondo i tipi «non esiste». Un buco che non si vede è
    // peggio di uno che si vede.
    //
    // Adesso si prende l'istruzione intera e si cercano dentro TUTTE le
    // clausole `add column`.
    const alterStmtRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+([\s\S]*?);/gi;
    let a;
    while ((a = alterStmtRe.exec(sql)) !== null) {
      const table = a[1];
      const corpo = a[2];
      const addColRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\s+([^,]+)/gi;
      let c;
      while ((c = addColRe.exec(corpo)) !== null) {
        if (!tables[table]) tables[table] = {};
        const parsed = parseColumnLine(`${c[1]} ${c[2]}`);
        if (parsed) tables[table][parsed.name] = { tsType: parsed.tsType, nullable: parsed.nullable, hasDefault: parsed.hasDefault };
      }
    }

    // --- DROP TABLE --- (riflette le rimozioni: lo schema netto, non solo le create)
    const dropTableRe = /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*;/gi;
    let dt;
    while ((dt = dropTableRe.exec(sql)) !== null) {
      delete tables[dt[1]];
    }

    // --- ALTER TABLE DROP COLUMN --- (uno o più drop nello stesso statement)
    const alterDropRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+([\s\S]*?);/gi;
    let ad;
    while ((ad = alterDropRe.exec(sql)) !== null) {
      const table = ad[1];
      if (!tables[table]) continue;
      const dropColRe = /drop\s+column\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
      let dcol;
      while ((dcol = dropColRe.exec(ad[2])) !== null) {
        delete tables[table][dcol[1]];
      }
    }
  }
  return tables;
}

function generate() {
  const tables = buildSchema();
  const tableNames = Object.keys(tables).sort();

  let out = `// AUTO-GENERATO da scripts/gen-db-types.mjs — NON modificare a mano.
// Fonte: migrations/*.sql. Rigenerare con: node scripts/gen-db-types.mjs
// Sostituto offline di \`supabase gen types\` (no DB access richiesto).
// CAVEAT: riflette le migrations, non modifiche manuali via dashboard.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
`;

  for (const table of tableNames) {
    const cols = tables[table];
    const colNames = Object.keys(cols);
    if (colNames.length === 0) continue;
    out += `      ${table}: {\n        Row: {\n`;
    for (const c of colNames) {
      const { tsType, nullable } = cols[c];
      out += `          ${c}: ${tsType}${nullable ? ' | null' : ''};\n`;
    }
    out += `        };\n`;
    // Insert: campi con default o nullable sono opzionali
    out += `        Insert: {\n`;
    for (const c of colNames) {
      const { tsType, nullable, hasDefault } = cols[c];
      const optional = nullable || hasDefault;
      out += `          ${c}${optional ? '?' : ''}: ${tsType}${nullable ? ' | null' : ''};\n`;
    }
    out += `        };\n`;
    // Update: tutti opzionali
    out += `        Update: {\n`;
    for (const c of colNames) {
      const { tsType, nullable } = cols[c];
      out += `          ${c}?: ${tsType}${nullable ? ' | null' : ''};\n`;
    }
    out += `        };\n        Relationships: [];\n      };\n`;
  }

  out += `    };
    Views: { [key: string]: never };
    Functions: { [key: string]: never };
    Enums: { [key: string]: never };
    CompositeTypes: { [key: string]: never };
  };
}
`;

  writeFileSync(OUT, out, 'utf8');
  console.log(`✓ Generated ${OUT}`);
  console.log(`  ${tableNames.length} tables, ${tableNames.reduce((s, t) => s + Object.keys(tables[t]).length, 0)} columns total`);
}

generate();
