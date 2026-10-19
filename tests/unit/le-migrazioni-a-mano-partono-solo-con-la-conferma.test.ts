/**
 * 19/10/2026 — IL PULSANTE CHE SCRIVE SUL DATABASE DI PRODUZIONE.
 *
 * `.github/workflows/migrazioni-a-mano.yml` applica al database vero le
 * migrazioni che mancano. Prima di toccarlo deve fermarsi in due casi:
 * quando chi lo avvia non ha scritto APPLICA, e quando la riga del database
 * non e' quella del Session pooler (la connessione diretta da GitHub non si
 * raggiunge, e il lavoro morirebbe con un errore di rete che non si capisce).
 *
 * Queste prove non cercano parole nel file: prendono il pezzo di shell vero
 * dal lavoro e lo eseguono con i valori che una persona puo' scrivere.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
// Lettore minimo dei passi del lavoro, senza librerie: il nome del passo, il suo
// blocco `run: |` riportato a filo e le righe `CHIAVE: valore` del suo `env:`.
type Passo = { name: string; run?: string; env: Record<string, string> };
const testo = readFileSync(join(process.cwd(), '.github/workflows/migrazioni-a-mano.yml'), 'utf8');
const righe = testo.split('\n');
const rientro = (r: string) => r.length - r.trimStart().length;
const passi: Passo[] = [];
for (let i = 0; i < righe.length; i++) {
  const m = righe[i].match(/^(\s*)- name: (.+)$/);
  if (!m) continue;
  const base = m[1].length;
  const p: Passo = { name: m[2].trim(), env: {} };
  let j = i + 1;
  while (j < righe.length && (righe[j].trim() === '' || rientro(righe[j]) > base)) {
    const r = righe[j];
    if (/^\s*run: \|\s*$/.test(r)) {
      const dentro = rientro(r);
      const corpo: string[] = [];
      j++;
      while (j < righe.length && (righe[j].trim() === '' || rientro(righe[j]) > dentro)) {
        corpo.push(righe[j]);
        j++;
      }
      const filo = Math.min(...corpo.filter((x) => x.trim()).map(rientro));
      p.run = corpo.map((x) => x.slice(filo)).join('\n');
      continue;
    }
    const run1 = r.match(/^\s*run: (.+)$/);
    if (run1) p.run = run1[1];
    const env = r.match(/^\s+([A-Z_]+): (.+)$/);
    if (env) p.env[env[1]] = env[2].replace(/^"(.*)"$/, '$1');
    j++;
  }
  passi.push(p);
}
const passo = (nome: string) => {
  const p = passi.find((x) => x.name === nome);
  expect(p, `nel lavoro manca il passo «${nome}»`).toBeDefined();
  return p as Passo;
};
const esegui = (codice: string, env: Record<string, string>) =>
  spawnSync('bash', ['-c', codice], { encoding: 'utf8', env: { ...process.env, ...env } });

// Un `bash` finto al posto dello script vero: stampa l'elenco come lo stampa lo
// script quando si ferma prima di scrivere, ed esce col codice che gli diamo.
const bashFinto = (uscita: number, mancano: string[], applica: string[] = []) => `bash() {
  ${applica.map((f) => `echo "▶ applico ${f}"`).join('; ') || ':'}
  ${mancano.length ? `echo "  Quelle che mancano:" >&2; ${mancano.map((f) => `echo "    - ${f}" >&2`).join('; ')}` : ':'}
  return ${uscita}
}
`;
const RIEPILOGO = { GITHUB_STEP_SUMMARY: '/dev/null' };

describe('le migrazioni a mano partono solo con la conferma scritta', () => {
  it('si avvia soltanto a mano, solo dal ramo principale, in un ambiente che Nicola puo\' frenare', () => {
    const on = testo.slice(testo.indexOf('\non:'), testo.indexOf('\nconcurrency:'));
    expect(on).toContain('workflow_dispatch:');
    expect(on).not.toMatch(/^\s+(push|pull_request|schedule|workflow_run):/m);
    expect(on).toMatch(/conferma:[\s\S]*required: true[\s\S]*quante:[\s\S]*required: true/);
    expect(testo).toContain("if: github.ref == 'refs/heads/main'");
    expect(testo).toMatch(/^\s+environment: database-produzione$/m);
  });

  it('si mette in fila col rilascio automatico, che applica gli stessi file', () => {
    // Collaudo del 19/10: con due gruppi diversi, un'unione su main durante questo
    // lavoro faceva entrare due volte dieci migrazioni.
    const proprio = testo.match(/^concurrency:\n\s+group: (\S+)/m)?.[1];
    const rilascio = readFileSync(join(process.cwd(), '.github/workflows/deploy-dopo-ci.yml'), 'utf8')
      .match(/^concurrency:\n\s+group: (\S+)/m)?.[1];
    expect(rilascio).toBeDefined();
    expect(proprio).toBe(rilascio);
  });

  it('la conferma viene prima di qualunque altro passo', () => {
    expect(passi[0].name).toBe('La conferma scritta');
  });

  it('senza APPLICA si ferma, con APPLICA va avanti', () => {
    const codice = passo('La conferma scritta').run as string;
    for (const sbagliata of ['', 'applica', 'APPLICA ', 'si', 'vai']) {
      const r = esegui(codice, { CONFERMA: sbagliata, QUANTE: '48' });
      expect(r.status, `ha accettato la conferma «${sbagliata}»`).not.toBe(0);
    }
    expect(esegui(codice, { CONFERMA: 'APPLICA', QUANTE: '48' }).status).toBe(0);
  });

  it('il numero atteso deve essere un numero', () => {
    const codice = passo('La conferma scritta').run as string;
    for (const brutto of ['', 'tutte', '48 ', '-1', '4 8', '48;rm']) {
      const r = esegui(codice, { CONFERMA: 'APPLICA', QUANTE: brutto });
      expect(r.status, `ha accettato «${brutto}» come numero`).not.toBe(0);
    }
  });

  it('quello che si scrive nelle caselle passa da variabili, non incollato nei comandi', () => {
    for (const p of passi) {
      if (p.run) expect(p.run, `il passo «${p.name}» incolla un valore nel comando`).not.toMatch(/\$\{\{\s*inputs\./);
    }
    expect(passo('La conferma scritta').env.CONFERMA).toBe('${{ inputs.conferma }}');
  });

  it('non parte durante la copia notturna del database', () => {
    const codice = passo('Non durante la copia notturna').run as string;
    const alle = (ora: string) => esegui(`date() { echo ${ora}; }\n${codice}`, {});
    expect(alle('02').status).not.toBe(0);
    expect(alle('03').status).not.toBe(0);
    for (const ora of ['01', '04', '17', '23']) expect(alle(ora).status, `alle ${ora}`).toBe(0);
  });
});

describe('la riga del database deve essere quella del Session pooler', () => {
  const codice = () => passo('La riga del database').run as string;

  it('lascia passare la riga del Session pooler', () => {
    const r = esegui(codice(), {
      SUPABASE_DB_URL: 'postgresql://postgres.abcdefgh:segreta@aws-0-eu-west-3.pooler.supabase.com:5432/postgres',
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it('ferma la connessione diretta e il Transaction pooler', () => {
    for (const riga of [
      'postgresql://postgres:segreta@db.abcdefgh.supabase.co:5432/postgres',
      'postgresql://postgres.abcdefgh:segreta@aws-0-eu-west-3.pooler.supabase.com:6543/postgres',
    ]) {
      const r = esegui(codice(), { SUPABASE_DB_URL: riga });
      expect(r.status, `ha accettato ${riga.replace(/:[^:@]+@/, ':***@')}`).not.toBe(0);
      expect(r.stdout + r.stderr).toContain('Session pooler');
    }
  });

  it('ferma una riga vuota o incollata male, senza mai stamparla', () => {
    for (const brutta of ['', 'psql "postgresql://x"', ' postgresql://x', 'https://abcdefgh.supabase.co']) {
      const r = esegui(codice(), { SUPABASE_DB_URL: brutta });
      expect(r.status, `ha accettato la riga «${brutta}»`).not.toBe(0);
    }
    const r = esegui(codice(), { SUPABASE_DB_URL: 'valore-segretissimo-da-non-stampare' });
    expect(r.stdout + r.stderr).not.toContain('valore-segretissimo-da-non-stampare');
  });
});

describe('il conto prima di scrivere', () => {
  const codice = () => passo('Conta quelle che mancano, senza toccare niente').run as string;
  const dieci = Array.from({ length: 10 }, (_, i) => `1${i}0_migrazione.sql`);

  it('chiede allo script di fermarsi prima di scrivere (tetto 0)', () => {
    expect(codice()).toContain('MASSIMO_MIGRAZIONI=0 bash scripts/applica-migrazioni-mancanti.sh');
  });

  it('va avanti solo se ne mancano esattamente quante ne aspetti', () => {
    const giusto = esegui(bashFinto(4, dieci) + codice(), { QUANTE: '10', ...RIEPILOGO });
    expect(giusto.status, giusto.stdout + giusto.stderr).toBe(0);
    for (const attese of ['9', '11', '48', '0']) {
      const r = esegui(bashFinto(4, dieci) + codice(), { QUANTE: attese, ...RIEPILOGO });
      expect(r.status, `ne mancano 10 e ha accettato «${attese}»`).not.toBe(0);
    }
  });

  it('se non manca niente e ne aspettavi zero, va avanti', () => {
    expect(esegui(bashFinto(0, []) + codice(), { QUANTE: '0', ...RIEPILOGO }).status).toBe(0);
    expect(esegui(bashFinto(0, []) + codice(), { QUANTE: '48', ...RIEPILOGO }).status).not.toBe(0);
  });

  it('se lo script si ferma per un altro motivo, non va avanti', () => {
    for (const uscita of [1, 2, 3]) {
      const r = esegui(bashFinto(uscita, dieci) + codice(), { QUANTE: '10', ...RIEPILOGO });
      expect(r.status, `uscita ${uscita} dello script presa per buona`).not.toBe(0);
    }
  });
});

describe('quello che fa dopo il conto', () => {
  it('applica con lo script del rilascio, e il tetto e\' il numero contato', () => {
    const p = passo('Applica le migrazioni che mancano');
    expect(p.run).toContain('bash scripts/applica-migrazioni-mancanti.sh');
    expect(p.env.MASSIMO_MIGRAZIONI).toBe('${{ inputs.quante }}');
  });

  it('se lo script si ferma a meta\', il passo fallisce e il riepilogo dice cosa e\' entrato', () => {
    const codice = passo('Applica le migrazioni che mancano').run as string;
    const riepilogo = join(mkdtempSync(join(tmpdir(), 'migrazioni-a-mano-')), 'riepilogo.md');
    const r = esegui(bashFinto(3, [], ['120_a.sql', '130_b.sql']) + codice, { GITHUB_STEP_SUMMARY: riepilogo });
    expect(r.status).toBe(3);
    const scritto = readFileSync(riepilogo, 'utf8');
    expect(scritto).toContain('- 120_a.sql');
    expect(scritto).toContain('- 130_b.sql');
    expect(scritto).toContain('uscita 3');
  });

  it('la seconda passata non applica niente: se manca qualcosa si ferma', () => {
    const p = passo('Seconda passata, non deve mancare niente');
    expect(p.env.MASSIMO_MIGRAZIONI).toBe('0');
    const codice = p.run as string;
    expect(esegui(bashFinto(0, []) + codice, {}).status).toBe(0);
    expect(esegui(bashFinto(4, ['163_x.sql']) + codice, {}).status).not.toBe(0);
    expect(esegui(bashFinto(0, [], ['163_x.sql']) + codice, {}).status).not.toBe(0);
  });

  it('i controlli del passo 3 bocciano un esito che non e\' t|t|t|t|t', () => {
    const run = passo('I cinque controlli del passo 3').run as string;
    // Al posto del database vero, un psql finto che risponde come vogliamo.
    const finto = (esito: string) => `psql() { echo '${esito}'; }\n${run}`;
    const ok = esegui(finto('t|t|t|t|t'), { SUPABASE_DB_URL: 'x', ...RIEPILOGO });
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    for (const male of ['t|t|f|t|t', 'f|t|t|t|t', 't|t|t|t|', '']) {
      const r = esegui(finto(male), { SUPABASE_DB_URL: 'x', ...RIEPILOGO });
      expect(r.status, `ha accettato l'esito «${male}»`).not.toBe(0);
    }
  });

  it('i pacchetti si installano senza la riga del database nell\'ambiente', () => {
    // Collaudo del 19/10: un pacchetto con uno script d'installazione leggeva la
    // riga intera, password compresa.
    const installa = passo('Installa le dipendenze');
    expect(installa.run).toContain('npm ci');
    expect(Object.keys(installa.env)).not.toContain('SUPABASE_DB_URL');
    for (const p of passi) {
      if (p.env.SUPABASE_DB_URL) expect(p.run ?? '', `«${p.name}» installa pacchetti col segreto`).not.toMatch(/npm (ci|install)/);
    }
  });
});
