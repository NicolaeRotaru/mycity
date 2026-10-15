/**
 * 14/10/2026 — IL CONTROLLO CHE TIENE GLI SMOKE LONTANI DAI DATI VERI SI
 * SAREBBE SPENTO DA SOLO.
 *
 * In CI, prima di far girare gli smoke E2E contro un Supabase di prova, il
 * passo «Check E2E secrets» guarda se quel Supabase e' per caso la produzione
 * (#240: i segreti si chiamavano come quelli veri, e gli smoke scrivevano sul
 * database dei clienti). Il confronto cercava `<progetto>.supabase.co` dentro
 * SUPABASE_DB_URL: vero solo con la connessione diretta,
 * `db.<progetto>.supabase.co`.
 *
 * La copia notturna chiede di passare al Session pooler, dove il progetto sta
 * nel nome utente: `postgres.<progetto>@aws-0-….pooler.supabase.com`. Con
 * quella stringa il confronto non trovava piu' niente e lasciava partire gli
 * smoke contro la produzione — senza dire niente.
 *
 * Qui si esegue il blocco vero del workflow, con le tre forme dell'indirizzo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const workflow = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

// Il `run:` del passo «Check E2E secrets», tolta l'indentazione dello YAML.
const blocco: string | null = (() => {
  const i = workflow.indexOf('- name: Check E2E secrets');
  if (i < 0) return null;
  const run = workflow.indexOf('run: |', i);
  if (run < 0) return null;
  const righe = workflow.slice(run).split('\n').slice(1);
  const corpo: string[] = [];
  for (const r of righe) {
    if (r.trim() !== '' && !r.startsWith('          ')) break;
    corpo.push(r.slice(10));
  }
  return corpo.join('\n');
})();

const PROGETTO = 'clmpyfvpvfjgeviworth';

const prova = (produzione: string, urlProva = `https://${PROGETTO}.supabase.co`) => {
  expect(blocco, 'il passo «Check E2E secrets» non c\'e\' piu\': nessuno ferma gli smoke contro la produzione').not.toBeNull();
  const cartella = mkdtempSync(join(tmpdir(), 'smoke-produzione-'));
  const uscita = join(cartella, 'output');
  writeFileSync(uscita, '');
  const r = spawnSync('bash', ['-c', blocco as string], {
    encoding: 'utf8',
    env: {
      ...process.env,
      URL: urlProva,
      ANON: 'chiave-anonima-di-prova',
      URL_PRODUZIONE: produzione,
      GITHUB_OUTPUT: uscita,
    },
  });
  return { ...r, output: readFileSync(uscita, 'utf8') };
};

describe('gli smoke E2E non partono contro la produzione', () => {
  it('la ferma con la connessione diretta', () => {
    const r = prova(`postgresql://postgres:segreta@db.${PROGETTO}.supabase.co:5432/postgres`);
    expect(r.status, 'lasciati partire gli smoke contro la produzione (connessione diretta)').not.toBe(0);
    expect(r.output).not.toContain('enabled=true');
  });

  it('la ferma anche col Session pooler, dove il progetto sta nel nome utente', () => {
    const r = prova(`postgresql://postgres.${PROGETTO}:segreta@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`);
    expect(r.status, 'col Session pooler il controllo non riconosce la produzione: gli smoke scriverebbero sui dati veri').not.toBe(0);
    expect(r.output).not.toContain('enabled=true');
  });

  it('lascia partire un progetto di prova diverso', () => {
    const r = prova(
      `postgresql://postgres.${PROGETTO}:segreta@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`,
      'https://unprogettodiprovadiverso.supabase.co',
    );
    expect(r.status, 'bloccato un progetto di prova che non e\' la produzione').toBe(0);
    expect(r.output).toContain('enabled=true');
  });

  it('non stampa mai il valore del segreto', () => {
    const r = prova(`postgresql://postgres.${PROGETTO}:parolachiave-segretissima@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`);
    expect(r.stdout + r.stderr).not.toContain('parolachiave-segretissima');
  });
});
