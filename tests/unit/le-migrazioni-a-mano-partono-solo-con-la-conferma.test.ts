/**
 * 19/10/2026 — IL PULSANTE CHE SCRIVE SUL DATABASE DI PRODUZIONE.
 *
 * `.github/workflows/migrazioni-a-mano.yml` applica al database vero le
 * migrazioni che mancano, in due lavori: uno conta senza scrivere, l'altro
 * scrive. Prima di scrivere deve fermarsi quando chi lo avvia non ha scritto
 * APPLICA, quando le migrazioni che mancano non sono quelle attese (quante e
 * quale e' l'ultima), quando la riga del database non e' quella del Session
 * pooler e quando sta girando la copia notturna.
 *
 * Queste prove non cercano parole nel file: prendono il pezzo di shell vero
 * dal lavoro (o lo script che il lavoro chiama) e lo eseguono con i valori che
 * una persona puo' scrivere. Al posto dello script delle migrazioni e di psql
 * ci sono dei finti, che rispondono come rispondono quelli veri.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// Lettore minimo dei passi di un lavoro, senza librerie: il nome del passo, il
// suo blocco `run: |` riportato a filo e le righe `CHIAVE: valore` del suo `env:`.
type Passo = { name: string; run?: string; env: Record<string, string> };
const testo = readFileSync(join(process.cwd(), '.github/workflows/migrazioni-a-mano.yml'), 'utf8');
const lavoro = (nome: 'conta' | 'applica') => {
  const inizio = testo.indexOf(`\n  ${nome}:\n`);
  expect(inizio, `nel file manca il lavoro «${nome}»`).toBeGreaterThan(-1);
  const dopo = testo.slice(inizio + 1).search(/\n {2}[a-z_]+:\n/);
  return dopo < 0 ? testo.slice(inizio) : testo.slice(inizio, inizio + 1 + dopo);
};
const rientro = (r: string) => r.length - r.trimStart().length;
const passiDi = (sezione: string): Passo[] => {
  const righe = sezione.split('\n');
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
  return passi;
};
const conta = passiDi(lavoro('conta'));
const applica = passiDi(lavoro('applica'));
const passo = (passi: Passo[], nome: string) => {
  const p = passi.find((x) => x.name === nome);
  expect(p, `nel lavoro manca il passo «${nome}»`).toBeDefined();
  return p as Passo;
};
const esegui = (codice: string, env: Record<string, string>) =>
  spawnSync('bash', ['-c', codice], { encoding: 'utf8', env: { ...process.env, ...env } });

// Un `bash` finto al posto dello script delle migrazioni: stampa quello che
// stampa lo script vero ed esce col codice che gli diamo.
const bashFinto = (uscita: number, mancano: string[], applicate: string[] = []) => `bash() {
  ${applicate.map((f) => `echo "▶ applico ${f}"`).join('; ') || ':'}
  ${mancano.length ? `echo "  Quelle che mancano:" >&2; ${mancano.map((f) => `echo "    - ${f}" >&2`).join('; ')}` : ':'}
  return ${uscita}
}
`;
const RIEPILOGO = { GITHUB_STEP_SUMMARY: '/dev/null' };
// Lo script del conto, eseguito col `bash` finto (con `.`, perche' la funzione finta valga dentro).
const contaCon = (finto: string, env: Record<string, string>) =>
  esegui(`${finto}\n. scripts/conta-migrazioni-mancanti.sh`, { ...RIEPILOGO, ...env });

describe('chi puo\' avviarlo, e quando', () => {
  it('si avvia soltanto a mano, con tre caselle obbligatorie', () => {
    const on = testo.slice(testo.indexOf('\non:'), testo.indexOf('\npermissions:'));
    expect(on).toContain('workflow_dispatch:');
    expect(on).not.toMatch(/^\s+(push|pull_request|schedule|workflow_run):/m);
    for (const casella of ['conferma', 'quante', 'ultima']) {
      expect(on, `la casella «${casella}» non e' obbligatoria`).toMatch(new RegExp(`${casella}:[^]*?required: true`));
    }
  });

  it('tutti e due i lavori girano solo da main', () => {
    for (const nome of ['conta', 'applica'] as const) {
      expect(lavoro(nome), `il lavoro «${nome}»`).toContain("if: github.ref == 'refs/heads/main'");
    }
  });

  it('il lavoro che scrive parte solo dopo quello che conta, ed e\' l\'unico nell\'ambiente da approvare', () => {
    expect(lavoro('applica')).toMatch(/^\s+needs: conta$/m);
    expect(lavoro('applica')).toMatch(/^\s+environment: database-produzione$/m);
    // Se l'ambiente stesse sul conto, Nicola approverebbe prima di vedere l'elenco.
    expect(lavoro('conta')).not.toMatch(/environment:/);
  });

  it('il lavoro che scrive si mette in fila col rilascio automatico, che applica gli stessi file', () => {
    // Collaudo del 19/10: con due gruppi diversi, un'unione su main durante il
    // lavoro faceva entrare due volte dieci migrazioni.
    const proprio = lavoro('applica').match(/concurrency:\n\s+group: (\S+)/)?.[1];
    const rilascio = readFileSync(join(process.cwd(), '.github/workflows/deploy-dopo-ci.yml'), 'utf8')
      .match(/^concurrency:\n\s+group: (\S+)/m)?.[1];
    expect(rilascio).toBeDefined();
    expect(proprio).toBe(rilascio);
  });

  it('la conferma viene prima di qualunque altro passo, e senza APPLICA si ferma', () => {
    expect(conta[0].name).toBe('La conferma scritta');
    const codice = conta[0].run as string;
    for (const sbagliata of ['', 'applica', 'APPLICA ', 'si', 'vai']) {
      expect(esegui(codice, { CONFERMA: sbagliata }).status, `ha accettato «${sbagliata}»`).not.toBe(0);
    }
    expect(esegui(codice, { CONFERMA: 'APPLICA' }).status).toBe(0);
  });

  it('quello che si scrive nelle caselle passa da variabili, non incollato nei comandi', () => {
    for (const p of [...conta, ...applica]) {
      if (p.run) expect(p.run, `il passo «${p.name}» incolla un valore nel comando`).not.toMatch(/\$\{\{\s*inputs\./);
    }
  });

  it('non parte, e non scrive, durante la copia notturna', () => {
    for (const passi of [conta, applica]) {
      const codice = passo(passi, 'Non durante la copia notturna').run as string;
      const alle = (hhmm: string) => esegui(`date() { echo ${hhmm}; }\n${codice}`, {});
      for (const ora of ['0130', '0217', '0341', '0459']) expect(alle(ora).status, `alle ${ora}`).not.toBe(0);
      for (const ora of ['0000', '0129', '0500', '1700', '2359']) expect(alle(ora).status, `alle ${ora}`).toBe(0);
    }
    // Il controllo nel lavoro che scrive viene prima di qualunque scrittura.
    expect(applica[0].name).toBe('Non durante la copia notturna');
  });
});

describe('la riga del database deve essere quella del Session pooler', () => {
  const codice = () => passo(conta, 'La riga del database').run as string;

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
      expect(esegui(codice(), { SUPABASE_DB_URL: brutta }).status, `ha accettato «${brutta}»`).not.toBe(0);
    }
    const r = esegui(codice(), { SUPABASE_DB_URL: 'valore-segretissimo-da-non-stampare' });
    expect(r.stdout + r.stderr).not.toContain('valore-segretissimo-da-non-stampare');
  });
});

describe('il conto, prima di scrivere e di nuovo subito prima', () => {
  const elenco = ['092_a.sql', '093_b.sql', '161_c.sql', '163_d.sql'];

  it('tutti e due i lavori contano con lo stesso script, prima di scrivere', () => {
    expect(passo(conta, 'Conta quelle che mancano').run).toBe('bash scripts/conta-migrazioni-mancanti.sh');
    expect(passo(applica, 'Riconta subito prima di scrivere').run).toBe('bash scripts/conta-migrazioni-mancanti.sh');
    const nomi = applica.map((p) => p.name);
    expect(nomi.indexOf('Riconta subito prima di scrivere')).toBeLessThan(nomi.indexOf('Applica le migrazioni che mancano'));
    for (const p of [passo(conta, 'Conta quelle che mancano'), passo(applica, 'Riconta subito prima di scrivere')]) {
      expect(p.env.QUANTE).toBe('${{ inputs.quante }}');
      expect(p.env.ULTIMA).toBe('${{ inputs.ultima }}');
    }
  });

  it('chiede allo script delle migrazioni di fermarsi prima di scrivere (tetto 0)', () => {
    expect(readFileSync(join(process.cwd(), 'scripts/conta-migrazioni-mancanti.sh'), 'utf8'))
      .toContain('MASSIMO_MIGRAZIONI=0 bash scripts/applica-migrazioni-mancanti.sh');
  });

  it('va avanti solo se ne mancano quante ne aspetti, e l\'ultima e\' quella attesa', () => {
    const giusto = contaCon(bashFinto(4, elenco), { QUANTE: '4', ULTIMA: '163' });
    expect(giusto.status, giusto.stdout + giusto.stderr).toBe(0);
    for (const quante of ['3', '5', '48', '04', '']) {
      expect(contaCon(bashFinto(4, elenco), { QUANTE: quante, ULTIMA: '163' }).status, `quante «${quante}»`).not.toBe(0);
    }
    // Il numero torna, ma l'ultima no: 47 attese piu' una sconosciuta fanno 48 lo stesso.
    for (const ultima of ['161', '164', '16', 'tutte', '']) {
      expect(contaCon(bashFinto(4, elenco), { QUANTE: '4', ULTIMA: ultima }).status, `ultima «${ultima}»`).not.toBe(0);
    }
  });

  it('una casella scritta male ferma il conto prima ancora di chiedere al database', () => {
    const segno = join(mkdtempSync(join(tmpdir(), 'conto-')), 'chiamato');
    // Il `bash` finto lascia un segno se viene chiamato: qui non deve esserlo mai.
    const finto = `bash() { touch "${segno}"; return 0; }\n`;
    const casi: Array<[string, string]> = [
      ['', '163'], ['4x', '163'], [' 4', '163'], ['-1', '163'],
      ['0', ''], ['0', '16'], ['0', '1634'], ['0', 'tutte'], ['0', '163_'],
    ];
    for (const [quante, ultima] of casi) {
      const r = contaCon(finto, { QUANTE: quante, ULTIMA: ultima });
      expect(r.status, `quante «${quante}», ultima «${ultima}»`).not.toBe(0);
      expect(existsSync(segno), `con quante «${quante}» e ultima «${ultima}» ha interrogato il database`).toBe(false);
    }
  });

  it('se non manca niente e ne aspettavi zero, va avanti', () => {
    expect(contaCon(bashFinto(0, []), { QUANTE: '0', ULTIMA: '163' }).status).toBe(0);
    expect(contaCon(bashFinto(0, []), { QUANTE: '48', ULTIMA: '163' }).status).not.toBe(0);
  });

  it('se lo script delle migrazioni si ferma per un altro motivo, non va avanti', () => {
    for (const uscita of [1, 2, 3]) {
      expect(contaCon(bashFinto(uscita, elenco), { QUANTE: '4', ULTIMA: '163' }).status, `uscita ${uscita}`).not.toBe(0);
    }
  });
});

describe('quello che fa il lavoro che scrive', () => {
  it('applica con lo script del rilascio, e il tetto e\' il numero contato', () => {
    const p = passo(applica, 'Applica le migrazioni che mancano');
    expect(p.run).toContain('bash scripts/applica-migrazioni-mancanti.sh');
    expect(p.env.MASSIMO_MIGRAZIONI).toBe('${{ inputs.quante }}');
  });

  it('se lo script si ferma a meta\', il passo fallisce e il riepilogo dice cosa e\' entrato e su quale file', () => {
    const codice = passo(applica, 'Applica le migrazioni che mancano').run as string;
    const riepilogo = join(mkdtempSync(join(tmpdir(), 'migrazioni-a-mano-')), 'riepilogo.md');
    // 113 gira in una transazione sola; 153 ha un COMMIT suo.
    for (const [ultimo, avviso] of [
      ['113_revoke_public_writes_on_views.sql', 'transazione sola'],
      ['153_il_reso_lo_apre_il_server_non_il_cliente.sql', 'COMMIT suo'],
    ]) {
      const r = esegui(bashFinto(3, [], ['111_rider_fee_cents.sql', ultimo]) + codice, { GITHUB_STEP_SUMMARY: riepilogo });
      expect(r.status).toBe(3);
      const scritto = readFileSync(riepilogo, 'utf8');
      expect(scritto).toContain('- 111_rider_fee_cents.sql');
      expect(scritto).toContain(`su ${ultimo}`);
      expect(scritto.slice(scritto.lastIndexOf('uscita 3'))).toContain(avviso);
    }
  });

  it('la seconda passata non applica niente: se manca qualcosa si ferma', () => {
    const p = passo(applica, 'Seconda passata, non deve mancare niente');
    expect(p.env.MASSIMO_MIGRAZIONI).toBe('0');
    const codice = p.run as string;
    expect(esegui(bashFinto(0, []) + codice, {}).status).toBe(0);
    expect(esegui(bashFinto(4, ['163_x.sql']) + codice, {}).status).not.toBe(0);
    expect(esegui(bashFinto(0, [], ['163_x.sql']) + codice, {}).status).not.toBe(0);
  });

  it('i controlli del passo 3 bocciano un esito che non e\' t|t|t|t|t', () => {
    const run = passo(applica, 'I cinque controlli del passo 3').run as string;
    // Al posto del database vero, un psql finto che risponde come vogliamo.
    const finto = (esito: string) => `psql() { echo '${esito}'; }\n${run}`;
    const ok = esegui(finto('t|t|t|t|t'), { SUPABASE_DB_URL: 'x', ...RIEPILOGO });
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    for (const male of ['t|t|f|t|t', 'f|t|t|t|t', 't|t|t|t|', '']) {
      expect(esegui(finto(male), { SUPABASE_DB_URL: 'x', ...RIEPILOGO }).status, `esito «${male}»`).not.toBe(0);
    }
  });

  it('i pacchetti si installano senza la riga del database nell\'ambiente', () => {
    // Collaudo del 19/10: un pacchetto con uno script d'installazione leggeva la
    // riga intera, password compresa.
    const installa = passo(applica, 'Installa le dipendenze');
    expect(installa.run).toContain('npm ci');
    expect(Object.keys(installa.env)).not.toContain('SUPABASE_DB_URL');
    for (const p of [...conta, ...applica]) {
      if (p.env.SUPABASE_DB_URL) expect(p.run ?? '', `«${p.name}» installa pacchetti col segreto`).not.toMatch(/npm (ci|install)/);
    }
  });
});
