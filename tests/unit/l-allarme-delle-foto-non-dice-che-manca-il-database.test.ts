import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copiaFoto, secchiDaCopiare, secchiPubblici, tettoDaMb } from '../../scripts/copia-foto.mjs';
import type { LavoroYaml, PassoYaml } from './_condizioni-github';

/**
 * 1/11/2026 — COLLAUDO DELLA COPIA DELLE FOTO: QUELLO CHE NON REGGEVA.
 *
 * ① Senza la chiave delle foto cadeva solo il passo delle foto, ma l'allarme
 *    scriveva «la copia notturna del database non e' riuscita, non c'e' una
 *    copia nuova»: falso ogni notte, e la notte in cui il database cade davvero
 *    sarebbe stata una riga in piu' in una segnalazione che tutti ignorano.
 * ② Il passo delle foto non aveva un tempo massimo, i download nemmeno: un
 *    fornitore muto portava il lavoro al suo limite, il lavoro veniva
 *    annullato e «Conserva la copia» (che sta dopo e gira con !cancelled())
 *    saltava. Il database moriva col contenitore, senza allarme.
 * ③ FOTO_SECCHI="products cod-proof" copiava cod-proof, un magazzino privato.
 * ④ I segnaposto delle cartelle vuote contavano come foto, e un file
 *    cancellato fra l'elenco e il download fermava tutta la copia.
 * ⑤ FOTO_TETTO_MB="tanti" diventava NaN e spegneva il tetto.
 */
const richiedi = createRequire(import.meta.url);
const yaml = richiedi('js-yaml') as { load: (testo: string) => unknown };

type Lavoro = LavoroYaml & { steps: Array<PassoYaml & { 'timeout-minutes'?: number }> };
function lavoro(nome: string): Lavoro {
  const doc = yaml.load(readFileSync(join(process.cwd(), '.github/workflows/backup-db.yml'), 'utf8')) as {
    jobs: Record<string, Lavoro>;
  };
  return doc.jobs[nome];
}
const passo = (l: Lavoro, nome: string) => {
  const p = l.steps.find((s) => s.name === nome);
  if (!p) throw new Error(`manca il passo «${nome}»`);
  return p;
};
const allarme = (l: Lavoro) => {
  const p = l.steps.find((s) => /allarme/i.test(s.name ?? ''));
  if (!p) throw new Error('manca il passo dell allarme');
  return p;
};

/** Esegue il passo d'allarme con un gh finto e gli esiti dei passi scelti. */
function suona(p: PassoYaml, esiti: Record<string, string>, aperta = '') {
  const scena = mkdtempSync(join(tmpdir(), 'allarme-foto-'));
  try {
    mkdirSync(join(scena, 'bin'));
    const registro = join(scena, 'gh.txt');
    writeFileSync(registro, '');
    writeFileSync(join(scena, 'riepilogo.md'), '');
    writeFileSync(join(scena, 'bin', 'gh'), `#!/usr/bin/env bash
printf '%s' "$*" | tr '\\n' ' ' >> "$REGISTRO"; printf '\\n' >> "$REGISTRO"
if [ "$1 $2" = "issue list" ]; then printf '%s' "$FINTA_APERTA"; fi
exit 0
`);
    chmodSync(join(scena, 'bin', 'gh'), 0o755);
    // Gli esiti arrivano dalle righe `env:` del passo: si sostituisce ogni
    // `${{ steps.<id>.outcome }}` / `.outputs.uscita` con l'esito della scena,
    // cosi' un id sbagliato nel file lascia la variabile vuota e la prova lo vede.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.env ?? {})) {
      const testo = String(v);
      const m = /^\$\{\{\s*steps\.([a-z0-9-]+)\.(outcome|outputs\.uscita)\s*\}\}$/.exec(testo);
      env[k] = m ? (esiti[`${m[1]}.${m[2]}`] ?? '') : testo.includes('${{') ? 'x' : testo;
    }
    const r = spawnSync('bash', ['-c', String(p.run)], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...env,
        PATH: `${join(scena, 'bin')}:${process.env.PATH}`,
        REGISTRO: registro,
        GITHUB_STEP_SUMMARY: join(scena, 'riepilogo.md'),
        FINTA_APERTA: aperta,
        DEPOSITO: 'NicolaeRotaru/mycity',
        PROPRIETARIO: 'NicolaeRotaru',
        INDIRIZZO_CORSA: 'https://github.com/x/actions/runs/1',
      },
    });
    return { uscita: r.status, chiamate: readFileSync(registro, 'utf8').split('\n').filter(Boolean) };
  } finally {
    rmSync(scena, { recursive: true, force: true });
  }
}

describe('① l allarme notturno dice cosa e caduto', () => {
  const notte = lavoro('backup');
  const soloFoto = { 'dump.outcome': 'success', 'conserva.outcome': 'success', 'copia-foto.outcome': 'failure' };

  it('cadute solo le foto per la chiave mancante: segnalazione delle foto, non del database', () => {
    const r = suona(allarme(notte), { ...soloFoto, 'copia-foto.outputs.uscita': '3' });
    expect(r.uscita).toBe(0);
    const apertura = r.chiamate.find((c) => c.startsWith('issue create')) ?? '';
    expect(apertura).toContain('Le foto non sono nella copia di sicurezza (il database sì)');
    expect(apertura, 'dice che manca la copia del database quando c e').not.toContain("non c'e' una copia nuova");
    expect(apertura).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('chiave ancora mancante e segnalazione gia aperta: niente commento ogni notte', () => {
    const r = suona(allarme(notte), { ...soloFoto, 'copia-foto.outputs.uscita': '3' }, '12');
    expect(r.chiamate.some((c) => c.startsWith('issue comment'))).toBe(false);
    expect(r.chiamate.some((c) => c.startsWith('issue create'))).toBe(false);
  });

  it('foto cadute per un guasto vero, segnalazione aperta: si aggiunge il commento', () => {
    const r = suona(allarme(notte), { ...soloFoto, 'copia-foto.outputs.uscita': '1' }, '12');
    expect(r.chiamate.some((c) => c.startsWith('issue comment 12'))).toBe(true);
  });

  it('se cade il database o la sua conservazione, la segnalazione e quella del database', () => {
    for (const esiti of [
      { 'dump.outcome': 'failure', 'conserva.outcome': 'success' },
      { 'dump.outcome': 'success', 'conserva.outcome': 'failure' },
      { 'dump.outcome': 'skipped', 'conserva.outcome': 'success' },
    ]) {
      const r = suona(allarme(notte), { ...esiti, 'copia-foto.outputs.uscita': '3' });
      const apertura = r.chiamate.find((c) => c.startsWith('issue create')) ?? '';
      expect(apertura, JSON.stringify(esiti)).toContain("La copia notturna del database non e' riuscita");
    }
  });

  it('il passo foto passa al lavoro l uscita 3 dello script, non un 1 qualunque', () => {
    const backup = mkdtempSync(join(tmpdir(), 'uscita-3-'));
    try {
      const r = spawnSync('bash', ['scripts/copia-foto.sh', 'copia'], {
        encoding: 'utf8',
        env: { ...process.env, FOTO_CHIAVE_SERVIZIO: '', SUPABASE_URL: 'http://127.0.0.1:9', BACKUP_PASSPHRASE: 'p', BACKUP_DIR: backup, GITHUB_STEP_SUMMARY: '' },
      });
      expect(r.status).toBe(3);
    } finally {
      rmSync(backup, { recursive: true, force: true });
    }
    expect(String(passo(notte, 'Copia le foto accanto al database').run)).toContain('uscita=$uscita');
  });
});

describe('① la prova mensile dice se a cadere sono solo le foto', () => {
  const mese = lavoro('prova-di-ripristino');
  it('database riaperto, foto no: titolo delle foto', () => {
    const r = suona(allarme(mese), { 'fresca.outcome': 'success', 'riapri-db.outcome': 'success' });
    const apertura = r.chiamate.find((c) => c.startsWith('issue create')) ?? '';
    expect(apertura).toContain('il database si riapre, le foto no');
    expect(apertura).not.toContain('non sappiamo se la copia di sicurezza si riapre');
  });
  it('database non riaperto: titolo del ripristino', () => {
    const r = suona(allarme(mese), { 'fresca.outcome': 'success', 'riapri-db.outcome': 'failure' });
    expect(r.chiamate.find((c) => c.startsWith('issue create')) ?? '').toContain('La prova mensile di ripristino');
  });
});

describe('② un fornitore muto non porta via il database', () => {
  it('nella notte il database si conserva PRIMA delle foto, e le foto hanno un tempo massimo', () => {
    const nomi = lavoro('backup').steps.map((s) => s.name);
    expect(nomi.indexOf('Conserva la copia fuori dal contenitore')).toBeLessThan(nomi.indexOf('Copia le foto accanto al database'));
    for (const l of ['backup', 'prova-di-ripristino']) {
      const t = (passo(lavoro(l), 'Copia le foto accanto al database') as { 'timeout-minutes'?: number })['timeout-minutes'];
      expect(t, `in ${l} il passo foto non ha un tempo massimo`).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(15);
    }
  });

  it('ogni richiesta al fornitore ha una scadenza, e una richiesta muta fa fallire la copia', async () => {
    const segnali: unknown[] = [];
    const muto = ((_: unknown, o: RequestInit = {}) => {
      segnali.push(o.signal);
      return new Promise((_ok, no) => o.signal?.addEventListener('abort', () => no(new Error('scaduta'))));
    }) as typeof fetch;
    await expect(
      copiaFoto({ base: 'https://f', chiave: 'k', secchi: ['products'], cartella: tmpdir(), fetchFn: muto, scadenzaMs: 50, scrivi: () => {} }),
    ).rejects.toThrow();
    expect(segnali[0], 'la richiesta parte senza scadenza').toBeInstanceOf(AbortSignal);
  });
});

describe('③ solo i secchi pubblici, letti dalla casa delle regole', () => {
  it('i pubblici sono quelli di lib/storage/regole-secchi.ts, cod-proof no', () => {
    const p = secchiPubblici();
    expect([...p].sort()).toEqual(['products', 'reviews', 'stories']);
  });
  it('FOTO_SECCHI="products cod-proof" copia solo products', () => {
    const avvisi: string[] = [];
    expect(secchiDaCopiare('products cod-proof invoices', (r: string) => avvisi.push(r))).toEqual(['products']);
    expect(avvisi.join(' ')).toContain('cod-proof');
  });
  it('copiaFoto rifiuta un secchio privato anche chiamata direttamente', async () => {
    await expect(
      copiaFoto({ base: 'https://f', chiave: 'k', secchi: ['cod-proof'], cartella: tmpdir(), fetchFn: (() => { throw new Error('non doveva chiamare'); }) as unknown as typeof fetch, scrivi: () => {} }),
    ).rejects.toThrow(/cod-proof/);
  });
});

describe('④ segnaposto e file spariti', () => {
  it('salta i segnaposto e conta a parte i file spariti, senza fermare la copia', async () => {
    const fetchFn = (async (url: string | URL | Request, o: RequestInit = {}) => {
      const u = new URL(String(url));
      if (o.method === 'POST') {
        const { prefix, offset } = JSON.parse(String(o.body)) as { prefix: string; offset: number };
        if (offset > 0) return new Response('[]');
        const voci = prefix
          ? []
          : [{ name: '.emptyFolderPlaceholder', id: 'a' }, { name: 'pane.jpg', id: 'b' }, { name: 'sparita.jpg', id: 'c' }];
        return new Response(JSON.stringify(voci));
      }
      if (u.pathname.endsWith('/pane.jpg')) return new Response('foto');
      if (u.pathname.endsWith('/sparita.jpg')) return new Response('{"statusCode":"404","error":"not_found"}', { status: 400 });
      return new Response('', { status: 500 });
    }) as typeof fetch;
    const dove = mkdtempSync(join(tmpdir(), 'spariti-'));
    try {
      const esito = await copiaFoto({ base: 'https://f', chiave: 'k', secchi: ['products'], cartella: dove, fetchFn, scrivi: () => {} });
      expect(esito.file).toBe(1);
      expect(esito.spariti).toEqual(['products/sparita.jpg']);
    } finally {
      rmSync(dove, { recursive: true, force: true });
    }
  });
});

describe('⑤ il tetto non diventa NaN', () => {
  it('vuoto = 3000 MB, un numero vale, il resto e un errore chiaro', () => {
    expect(tettoDaMb('')).toBe(3000 * 1024 * 1024);
    expect(tettoDaMb('10')).toBe(10 * 1024 * 1024);
    expect(() => tettoDaMb('tanti')).toThrow(/FOTO_TETTO_MB/);
    expect(() => tettoDaMb('-5')).toThrow(/FOTO_TETTO_MB/);
  });
  it('lo script con FOTO_TETTO_MB sbagliato esce rosso e lo dice', () => {
    const r = spawnSync('node', ['scripts/copia-foto.mjs', tmpdir()], {
      encoding: 'utf8',
      env: { ...process.env, FOTO_CHIAVE_SERVIZIO: 'k', SUPABASE_URL: 'http://127.0.0.1:9', FOTO_TETTO_MB: 'tanti' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('FOTO_TETTO_MB');
  });
});
