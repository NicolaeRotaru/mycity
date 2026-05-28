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
  const cleaned = line.trim().replace(/,$/, '');
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

/** Parsing principale. */
function buildSchema() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  /** @type {Record<string, Record<string, {tsType:string,nullable:boolean,hasDefault:boolean}>>} */
  const tables = {};

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

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
    const alterRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\s+([^;,]+)/gi;
    let a;
    while ((a = alterRe.exec(sql)) !== null) {
      const table = a[1];
      const colName = a[2];
      const colDef = a[3];
      if (!tables[table]) tables[table] = {};
      const parsed = parseColumnLine(`${colName} ${colDef}`);
      if (parsed) tables[table][parsed.name] = { tsType: parsed.tsType, nullable: parsed.nullable, hasDefault: parsed.hasDefault };
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
