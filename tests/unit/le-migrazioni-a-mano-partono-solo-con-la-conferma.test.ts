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
import { readFileSync } from 'node:fs';
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

describe('le migrazioni a mano partono solo con la conferma scritta', () => {
  it('si avvia soltanto a mano, e solo dal ramo principale', () => {
    const on = testo.slice(testo.indexOf('\non:'), testo.indexOf('\nconcurrency:'));
    expect(on).toContain('workflow_dispatch:');
    expect(on).not.toMatch(/^\s+(push|pull_request|schedule|workflow_run):/m);
    expect(on).toMatch(/conferma:[\s\S]*required: true/);
    expect(testo).toContain("if: github.ref == 'refs/heads/main'");
  });

  it('la conferma viene prima di qualunque altro passo', () => {
    expect(passi[0].name).toBe('La conferma scritta');
  });

  it('senza APPLICA si ferma, con APPLICA va avanti', () => {
    const codice = passo('La conferma scritta').run as string;
    for (const sbagliata of ['', 'applica', 'APPLICA ', 'si', 'vai']) {
      const r = esegui(codice, { CONFERMA: sbagliata });
      expect(r.status, `ha accettato la conferma «${sbagliata}»`).not.toBe(0);
    }
    expect(esegui(codice, { CONFERMA: 'APPLICA' }).status).toBe(0);
  });

  it('la conferma passa da una variabile, non incollata nel comando', () => {
    // Un valore come `APPLICA"; rm -rf ~; "` scritto nella casella non deve
    // diventare codice: il testo arriva solo come variabile d'ambiente.
    const p = passo('La conferma scritta');
    expect(p.run).not.toContain('${{');
    expect(p.env?.CONFERMA).toBe('${{ inputs.conferma }}');
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

  it('ferma la connessione diretta, che da GitHub non si raggiunge', () => {
    const r = esegui(codice(), {
      SUPABASE_DB_URL: 'postgresql://postgres:segreta@db.abcdefgh.supabase.co:5432/postgres',
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('Session pooler');
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

describe('quello che fa dopo i due controlli', () => {
  it('usa lo script del rilascio, poi lo rilancia e pretende zero', () => {
    const prima = passo('Applica le migrazioni che mancano');
    const seconda = passo('Seconda passata, deve applicarne zero');
    expect(prima.run).toContain('bash scripts/applica-migrazioni-mancanti.sh');
    expect(seconda.run).toContain('bash scripts/applica-migrazioni-mancanti.sh');
    expect(seconda.run).toContain("grep -q '^▶ applico '");
    // Il tetto lascia passare le 48 di oggi, e ferma ancora un database molto piu' indietro.
    expect(Number(prima.env?.MASSIMO_MIGRAZIONI)).toBeGreaterThanOrEqual(48);
    expect(Number(prima.env?.MASSIMO_MIGRAZIONI)).toBeLessThan(157);
  });

  it('i controlli del passo 3 bocciano un esito che non e\' t|t|t|t|t', () => {
    const run = passo('I cinque controlli del passo 3').run as string;
    // Al posto del database vero, un psql finto che risponde come vogliamo.
    const finto = (esito: string) => `psql() { echo '${esito}'; }\n${run}`;
    const ok = esegui(finto('t|t|t|t|t'), { SUPABASE_DB_URL: 'x', GITHUB_STEP_SUMMARY: '/dev/null' });
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    for (const male of ['t|t|f|t|t', 'f|t|t|t|t', 't|t|t|t|', '']) {
      const r = esegui(finto(male), { SUPABASE_DB_URL: 'x', GITHUB_STEP_SUMMARY: '/dev/null' });
      expect(r.status, `ha accettato l'esito «${male}»`).not.toBe(0);
    }
  });
});
