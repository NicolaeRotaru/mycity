import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { percorso, type EsitoFinto, type LavoroYaml } from './_condizioni-github';
import { copiaFoto, indirizzoDalDb, secchiDaCopiare } from '../../scripts/copia-foto.mjs';

/**
 * 1/11/2026 — LE FOTO DI PRODOTTI E NEGOZI NON ERANO IN NESSUNA COPIA.
 *
 * La copia notturna salvava database, utenti ed elenco delle foto; i file
 * veri no (il pezzo con rclone vuole un secchio a pagamento ed e' spento).
 * Adesso scripts/copia-foto.mjs li scarica dall'API Storage di Supabase e
 * scripts/copia-foto.sh li cifra accanto al database, nello stesso artefatto.
 *
 * Qui il fornitore e' FINTO ma parla come quello vero: un server HTTP con
 * l'elenco a pagine (`limit`/`offset`), le cartelle con `id: null` e i file
 * scaricabili solo con la chiave. Cosa non si prova da qui: che l'API vera di
 * Supabase risponda con questa stessa forma (scritta dalla documentazione,
 * mai chiamata con la chiave di produzione).
 */
const richiedi = createRequire(import.meta.url);
const yaml = richiedi('js-yaml') as { load: (testo: string) => unknown };

const CHIAVE = 'chiave-di-servizio-finta';
type Mondo = Record<string, Record<string, Buffer>>; // secchio → percorso → contenuto

type Risposta = { stato: number; corpo: Buffer };

/** Il fornitore finto: una funzione sola, usata dal server HTTP e dal fetch finto. */
function rispondi(mondo: Mondo, rotti: Set<string>, metodo: string, percorsoUrl: string, autorizzazione: string | undefined, corpo: string): Risposta {
  const testo = (s: string, stato = 200): Risposta => ({ stato, corpo: Buffer.from(s) });
  if (autorizzazione !== `Bearer ${CHIAVE}`) return testo('', 401);
  const lista = /^\/storage\/v1\/object\/list\/([^/]+)$/.exec(percorsoUrl);
  if (metodo === 'POST' && lista) {
    const secchio = decodeURIComponent(lista[1]);
    const { prefix, limit, offset } = JSON.parse(corpo) as { prefix: string; limit: number; offset: number };
    const file = mondo[secchio];
    if (!file) return testo('{}', 404);
    const dentro = prefix ? `${prefix}/` : '';
    const voci = new Map<string, { name: string; id: string | null }>();
    for (const p of Object.keys(file).sort()) {
      if (!p.startsWith(dentro)) continue;
      const [primo, ...altro] = p.slice(dentro.length).split('/');
      voci.set(primo, { name: primo, id: altro.length ? null : `id-${p}` });
    }
    const pagina = [...voci.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit);
    return testo(JSON.stringify(pagina));
  }
  const scarica = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(percorsoUrl);
  if (metodo === 'GET' && scarica) {
    const secchio = decodeURIComponent(scarica[1]);
    const nome = scarica[2].split('/').map(decodeURIComponent).join('/');
    const contenuto = mondo[secchio]?.[nome];
    if (!contenuto || rotti.has(`${secchio}/${nome}`)) return testo('guasto', 500);
    return { stato: 200, corpo: contenuto };
  }
  return testo('', 404);
}

/** In questo processo la rete e' chiusa (tests/unit/_setup.ts): si passa un fetch finto. */
function fetchFinto(mondo: Mondo, rotti: Set<string> = new Set()) {
  const chiamate: string[] = [];
  const fetchFn = (async (url: string | URL | Request, opzioni: RequestInit = {}) => {
    const u = new URL(String(url));
    const metodo = opzioni.method ?? 'GET';
    chiamate.push(`${metodo} ${u.pathname}`);
    const intestazioni = (opzioni.headers ?? {}) as Record<string, string>;
    const r = rispondi(mondo, rotti, metodo, u.pathname, intestazioni.Authorization, String(opzioni.body ?? ''));
    return new Response(new Uint8Array(r.corpo), { status: r.stato });
  }) as typeof fetch;
  return { base: 'https://finto.supabase.co', chiamate, fetchFn };
}

/** Per gli script veri (processi a parte): lo stesso fornitore dietro un server su 127.0.0.1. */
function finto(mondo: Mondo, rotti: Set<string> = new Set()) {
  const server: Server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      const r = rispondi(mondo, rotti, req.method ?? 'GET', new URL(req.url ?? '/', 'http://x').pathname, req.headers.authorization, corpo);
      res.writeHead(r.stato).end(r.corpo);
    });
  });
  return new Promise<{ base: string; chiudi: () => Promise<void> }>((ok) => {
    server.listen(0, '127.0.0.1', () => {
      const indirizzo = server.address();
      const porta = typeof indirizzo === 'object' && indirizzo ? indirizzo.port : 0;
      ok({ base: `http://127.0.0.1:${porta}`, chiudi: () => new Promise<void>((fatto) => server.close(() => fatto())) });
    });
  });
}

const MONDO: Mondo = {
  products: {
    'negozio-1/pane.jpg': Buffer.from('foto del pane'),
    'negozio-1/focaccia.jpg': Buffer.from('foto della focaccia'),
    'negozio-1/logo.png': Buffer.from('logo del negozio'),
    'negozio-2/torta.jpg': Buffer.from('foto della torta'),
    'radice.jpg': Buffer.from('foto in radice'),
  },
  stories: { 'negozio-1/storia.mp4': Buffer.from('una storia') },
  reviews: {},
  'kyc-docs': { 'utente-1/id_front.jpg': Buffer.from('CARTA D IDENTITA') },
};

const daPulire: Array<() => unknown> = [];
afterEach(async () => {
  while (daPulire.length) await daPulire.pop()?.();
});

function cartella(): string {
  const c = mkdtempSync(join(tmpdir(), 'copia-foto-'));
  daPulire.push(() => rmSync(c, { recursive: true, force: true }));
  return c;
}

async function fornitore(mondo: Mondo = MONDO, rotti?: Set<string>) {
  const f = await finto(mondo, rotti);
  daPulire.push(f.chiudi);
  return f;
}

describe('lo script che copia le foto', () => {
  it('elenca a pagine, entra nelle cartelle e scarica ogni file com e', async () => {
    const f = fetchFinto(MONDO);
    const dove = cartella();
    const esito = await copiaFoto({
      base: f.base, fetchFn: f.fetchFn, chiave: CHIAVE, secchi: ['products', 'stories', 'reviews'], cartella: dove, pagina: 2, scrivi: () => {},
    });
    expect(esito.file).toBe(6);
    expect(readFileSync(join(dove, 'products/negozio-1/logo.png'), 'utf8')).toBe('logo del negozio');
    expect(readFileSync(join(dove, 'products/negozio-2/torta.jpg'), 'utf8')).toBe('foto della torta');
    expect(readFileSync(join(dove, 'stories/negozio-1/storia.mp4'), 'utf8')).toBe('una storia');
    // negozio-1 ha 3 file: con pagine da 2 servono due richieste (offset 0 e 2).
    const elenchiProducts = f.chiamate.filter((c) => c === 'POST /storage/v1/object/list/products');
    expect(elenchiProducts.length, 'non ha chiesto la seconda pagina: i file oltre la prima si perdevano').toBeGreaterThanOrEqual(4);
  });

  it('kyc-docs non si scarica mai, nemmeno se qualcuno lo mette nell elenco', async () => {
    const avvisi: string[] = [];
    const secchi = secchiDaCopiare('products kyc-docs', (r: string) => avvisi.push(r));
    expect(secchi).toEqual(['products']);
    expect(avvisi.join(' ')).toContain('kyc-docs');

    const f = fetchFinto(MONDO);
    await expect(
      copiaFoto({ base: f.base, fetchFn: f.fetchFn, chiave: CHIAVE, secchi: ['kyc-docs'], cartella: cartella(), scrivi: () => {} }),
    ).rejects.toThrow(/kyc-docs/);
    expect(f.chiamate.some((c) => c.includes('kyc-docs')), 'ha bussato al secchio dei documenti d identita').toBe(false);
  });

  it('se un download fallisce, fallisce tutto e dice quale file', async () => {
    const f = fetchFinto(MONDO, new Set(['products/negozio-2/torta.jpg']));
    await expect(
      copiaFoto({ base: f.base, fetchFn: f.fetchFn, chiave: CHIAVE, secchi: ['products'], cartella: cartella(), scrivi: () => {} }),
    ).rejects.toThrow(/products\/negozio-2\/torta\.jpg/);
  });

  it('una chiave sbagliata non passa per «secchio vuoto»', async () => {
    const f = fetchFinto(MONDO);
    await expect(
      copiaFoto({ base: f.base, fetchFn: f.fetchFn, chiave: 'sbagliata', secchi: ['products'], cartella: cartella(), scrivi: () => {} }),
    ).rejects.toThrow(/401/);
  });

  it('un file da zero byte e una copia senza nessun file sono fallimenti', async () => {
    const f = fetchFinto({ products: { 'a.jpg': Buffer.alloc(0) }, reviews: {} });
    await expect(
      copiaFoto({ base: f.base, fetchFn: f.fetchFn, chiave: CHIAVE, secchi: ['products'], cartella: cartella(), scrivi: () => {} }),
    ).rejects.toThrow(/zero byte/);
    await expect(
      copiaFoto({ base: f.base, fetchFn: f.fetchFn, chiave: CHIAVE, secchi: ['reviews'], cartella: cartella(), scrivi: () => {} }),
    ).rejects.toThrow(/nessun file/);
  });

  it('l indirizzo del progetto si ricava dalla riga del Session pooler', () => {
    expect(indirizzoDalDb('postgresql://postgres.abcdef123:pw@aws-0-eu-west-3.pooler.supabase.com:5432/postgres'))
      .toBe('https://abcdef123.supabase.co');
    expect(indirizzoDalDb('postgresql://postgres:pw@localhost:5432/postgres')).toBeNull();
  });
});

function esegui(argomenti: string[], env: Record<string, string>) {
  return new Promise<{ uscita: number | null; testo: string }>((ok) => {
    const figlio = spawn('bash', argomenti, { cwd: process.cwd(), env: { ...process.env, ...env } });
    let testo = '';
    figlio.stdout.on('data', (d) => (testo += d));
    figlio.stderr.on('data', (d) => (testo += d));
    figlio.on('close', (uscita) => ok({ uscita, testo }));
  });
}

describe('la copia notturna delle foto, script vero e gpg vero', () => {
  it('scarica, cifra accanto al database senza lasciare niente in chiaro, e la prova riapre una foto', async () => {
    const f = await fornitore();
    const backup = cartella();
    const env = { SUPABASE_URL: f.base, FOTO_CHIAVE_SERVIZIO: CHIAVE, BACKUP_PASSPHRASE: 'prova', BACKUP_DIR: backup, GITHUB_STEP_SUMMARY: '' };
    const copia = await esegui(['scripts/copia-foto.sh', 'copia'], env);
    expect(copia.uscita, copia.testo).toBe(0);
    expect(copia.testo).toContain('esito-file-foto: copiati 6 file');
    const file = readdirSync(backup);
    expect(file.filter((n) => /^mycity-foto_.*\.tar\.gpg$/.test(n)).length, file.join(', ')).toBe(1);
    expect(file.filter((n) => !n.endsWith('.gpg')), 'foto in chiaro rimaste nella cartella della copia').toEqual([]);

    const riapri = await esegui(['scripts/copia-foto.sh', 'riapri'], env);
    expect(riapri.uscita, riapri.testo).toBe(0);
    expect(riapri.testo).toMatch(/Riaperta dalla copia: .+ \(\d+ byte\)/);
  });

  it('senza la chiave di servizio la notte e rossa e lo dice, senza lasciare pacchi', async () => {
    const backup = cartella();
    const r = await esegui(['scripts/copia-foto.sh', 'copia'], {
      SUPABASE_URL: 'http://127.0.0.1:9', FOTO_CHIAVE_SERVIZIO: '', BACKUP_PASSPHRASE: 'prova', BACKUP_DIR: backup, GITHUB_STEP_SUMMARY: '',
    });
    expect(r.uscita).not.toBe(0);
    expect(r.testo).toContain('esito-file-foto: non-configurato');
    expect(readdirSync(backup)).toEqual([]);
  });

  it('con un download rotto la notte e rossa e non esce un pacco a meta', async () => {
    const f = await fornitore(MONDO, new Set(['stories/negozio-1/storia.mp4']));
    const backup = cartella();
    const r = await esegui(['scripts/copia-foto.sh', 'copia'], {
      SUPABASE_URL: f.base, FOTO_CHIAVE_SERVIZIO: CHIAVE, BACKUP_PASSPHRASE: 'prova', BACKUP_DIR: backup, GITHUB_STEP_SUMMARY: '',
    });
    expect(r.uscita).not.toBe(0);
    expect(r.testo).toContain('esito-file-foto: fallita');
    expect(readdirSync(backup)).toEqual([]);
  });

  it('la prova di riapertura e rossa se nella copia non c e nessun pacco di foto', async () => {
    const r = await esegui(['scripts/copia-foto.sh', 'riapri'], { BACKUP_PASSPHRASE: 'prova', BACKUP_DIR: cartella() });
    expect(r.uscita).not.toBe(0);
    expect(r.testo).toContain('nessun pacco di foto');
  });
});

function lavoro(nome: string): LavoroYaml {
  const documento = yaml.load(
    readFileSync(join(process.cwd(), '.github/workflows/backup-db.yml'), 'utf8'),
  ) as { jobs?: Record<string, LavoroYaml> };
  const trovato = documento?.jobs?.[nome];
  if (!trovato?.steps?.length) throw new Error(`Non trovo il lavoro «${nome}»`);
  return trovato;
}
const FALLITO: EsitoFinto = { esito: 'failure' };

describe('il lavoro notturno e la prova mensile usano davvero la copia delle foto', () => {
  it('ogni notte le foto si copiano, dopo che il database e gia conservato, e si conservano anche loro', () => {
    const girati = percorso(lavoro('backup').steps ?? [], { event_name: 'schedule', schedule: '17 2 * * *' }, {});
    const foto = girati.indexOf('Copia le foto accanto al database');
    expect(foto, 'nessun passo copia le foto').toBeGreaterThan(-1);
    expect(girati.indexOf('Conserva la copia fuori dal contenitore')).toBeLessThan(foto);
    expect(girati.indexOf('Conserva le foto fuori dal contenitore')).toBeGreaterThan(foto);
  });

  it('se le foto cadono, il database si conserva lo stesso e l allarme suona', () => {
    const girati = percorso(lavoro('backup').steps ?? [], { event_name: 'schedule', schedule: '17 2 * * *' }, {
      'Copia le foto accanto al database': FALLITO,
    });
    expect(girati).toContain('Conserva la copia fuori dal contenitore');
    expect(girati.some((n) => /allarme/i.test(n))).toBe(true);
  });

  it('la prova mensile copia le foto e ne riapre una', () => {
    const girati = percorso(lavoro('prova-di-ripristino').steps ?? [], { event_name: 'schedule', schedule: '41 3 1 * *' }, {});
    expect(girati).toContain('Copia le foto accanto al database');
    expect(girati).toContain('Riapri una foto dalla copia');
    const passo = (lavoro('prova-di-ripristino').steps ?? []).find((p) => p.name === 'Riapri una foto dalla copia');
    expect(String(passo?.run)).toContain('copia-foto.sh riapri');
  });
});
