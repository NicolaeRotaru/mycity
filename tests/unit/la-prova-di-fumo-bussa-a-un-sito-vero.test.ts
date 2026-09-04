import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli, passo, esegui } from '@/tests/unit/_lavoro-di-rilascio';
import { manopoleDaAmbiente } from '@/scripts/prova-di-fumo.mjs';

/**
 * 3/9/2026 — LA PROVA DI FUMO NON AVEVA MAI BUSSATO A UNA PORTA VERA.
 *
 * Le prove di fianco (la-prova-di-fumo-boccia-un-sito-rotto) le passano una
 * `fetch` finta: mettono alla prova la SENTENZA, che e' giusto, ma non toccano
 * mai un socket. Restava fuori proprio quello che succede solo con la rete in
 * mezzo — un sito che accetta la connessione e poi non risponde piu', e
 * soprattutto una porta che risponde 401 perche' davanti al sito c'e' un muro.
 *
 * Qui il sito lo accendiamo per davvero: un server sulla porta 0 (la sceglie il
 * sistema), solo su 127.0.0.1, nessuna chiamata fuori da questo computer. E lo
 * script vero viene lanciato come lo lancia il lavoro di rilascio — a riga di
 * comando, guardando il NUMERO D'USCITA, che e' la cosa su cui il lavoro decide
 * se annullare un rilascio.
 *
 * PERCHE' IL SITO FINTO STA IN UN PROCESSO SUO. Il primo tentativo lo teneva
 * qui dentro, e non arrivava nessuna chiamata: `cli()` ed `esegui()` lanciano lo
 * script in modo BLOCCANTE, quindi finche' lo script gira questo processo e'
 * fermo e non puo' accettare niente. Tre controlli su tre «nessuna risposta
 * entro 1000 ms» su un sito sanissimo. Il server sta in un processo separato:
 * cosi' risponde mentre noi aspettiamo.
 *
 * IL CASO CHE HA FATTO NASCERE QUESTO FILE. Stato del progetto Vercel verificato
 * il 3/9/2026: nessun dominio personalizzato e «Vercel Authentication» accesa su
 * tutto il resto. Ogni indirizzo *.vercel.app risponde con la schermata di
 * accesso a chi non e' della squadra. La prova di fumo di prima leggeva quel 401
 * come «il sito e' rotto» — l'unico esito su cui il lavoro ANNULLA il rilascio.
 * Il giorno dell'accensione dei segreti, ogni pubblicazione sana sarebbe stata
 * buttata via da sola.
 */

/** Come deve rispondere una porta del sito finto. */
type Risposta = {
  stato: number;
  corpo?: string;
  tipo?: string;
  intestazioni?: Record<string, string>;
  /** Accetta la connessione e non risponde mai: il caso «non risponde entro il tetto». */
  muto?: boolean;
};

/**
 * Il sito finto, in un file suo. Riceve la sua configurazione come JSON e
 * annota ogni visita su disco, perche' e' l'unico modo che ha di raccontarla a
 * chi lo ha acceso: mentre lui risponde, noi siamo fermi ad aspettare.
 */
const SORGENTE_DEL_SITO = `
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const config = JSON.parse(process.argv[2]);
const registro = process.argv[3];

const server = createServer((richiesta, risposta) => {
  const percorso = (richiesta.url ?? '/').split('?')[0];
  const passaggio = richiesta.headers['x-vercel-protection-bypass'] ?? null;
  appendFileSync(registro, JSON.stringify({ percorso, passaggio }) + '\\n');

  // Il muro di Vercel si apre a chi ha la chiave di servizio: qui si comporta
  // come lui, cosi' la prova misura il passaggio e non la fiducia.
  const apre = config.chiaveDiPassaggio !== null && passaggio === config.chiaveDiPassaggio;
  const r = (apre ? config.sano[percorso] : config.risposte[percorso]) ?? { stato: 404, corpo: 'non c e' };
  if (r.muto) return; // di proposito: nessuna risposta, mai.
  risposta.writeHead(r.stato, { 'content-type': r.tipo ?? 'text/plain', ...(r.intestazioni ?? {}) });
  risposta.end(r.corpo ?? '');
});

server.listen(0, '127.0.0.1', () => {
  console.log('PRONTO ' + server.address().port);
});
`;

const SANO: Record<string, Risposta> = {
  '/api/health': { stato: 200, tipo: 'application/json', corpo: '{"status":"ok"}' },
  '/api/health/ready': { stato: 200, tipo: 'application/json', corpo: '{"status":"ready"}' },
  '/': { stato: 200, tipo: 'text/html', corpo: '<!doctype html><title>MyCity</title>' },
};

/** La schermata di accesso di Vercel, con il biscotto che ci mette lui. */
const MURO: Risposta = {
  stato: 401,
  tipo: 'text/html',
  intestazioni: { 'set-cookie': '_vercel_sso_nonce=abc123; Path=/; HttpOnly' },
  corpo: '<html><head><title>Authentication Required</title></head><body>vercel.com/sso-api</body></html>',
};

const DIETRO_IL_MURO: Record<string, Risposta> = { '/api/health': MURO, '/api/health/ready': MURO, '/': MURO };

let acceso: ChildProcess | null = null;

async function accendiUnSito(risposte: Record<string, Risposta>, opzioni: { chiaveDiPassaggio?: string } = {}) {
  const scena = mkdtempSync(join(tmpdir(), 'sito-finto-'));
  const sorgente = join(scena, 'sito.mjs');
  const registro = join(scena, 'visite.jsonl');
  writeFileSync(sorgente, SORGENTE_DEL_SITO);
  writeFileSync(registro, '');

  const config = JSON.stringify({ risposte, sano: SANO, chiaveDiPassaggio: opzioni.chiaveDiPassaggio ?? null });
  const figlio = spawn(process.execPath, [sorgente, config, registro], { stdio: ['ignore', 'pipe', 'pipe'] });
  acceso = figlio;

  const porta = await new Promise<string>((trovata, fallita) => {
    const scadenza = setTimeout(() => fallita(new Error('Il sito finto non si e acceso entro 10 secondi')), 10_000);
    let visto = '';
    figlio.stdout!.on('data', (pezzo) => {
      visto += String(pezzo);
      const riga = /PRONTO (\d+)/.exec(visto);
      if (riga) {
        clearTimeout(scadenza);
        trovata(riga[1]);
      }
    });
    figlio.on('exit', (codice) => fallita(new Error(`Il sito finto e morto subito (uscita ${codice})`)));
  });

  return {
    base: `http://127.0.0.1:${porta}`,
    visite: () =>
      (existsSync(registro) ? readFileSync(registro, 'utf8') : '')
        .split('\n')
        .filter(Boolean)
        .map((r) => JSON.parse(r) as { percorso: string; passaggio: string | null }),
  };
}

afterEach(() => {
  acceso?.kill('SIGKILL');
  acceso = null;
});

/**
 * Le manopole. Con i valori di tutti i giorni una prova su un sito che non
 * risponde dura piu' di un minuto: qui si stringono i tempi, non i controlli —
 * i tentativi restano veri, la rete resta vera.
 */
const SVELTE = { PROVA_TENTATIVI: '1', PROVA_ATTESA_MS: '0', PROVA_TIMEOUT_MS: '1000', VERCEL_AUTOMATION_BYPASS_SECRET: '' };

describe('la prova di fumo bussa a un sito vero', () => {
  it('un sito che risponde come deve passa', async () => {
    const sito = await accendiUnSito(SANO);
    const esito = cli([sito.base], { env: SVELTE });

    expect(esito.uscita, `${esito.stdout}${esito.stderr}`).toBe(0);
    expect(sito.visite().map((v) => v.percorso)).toEqual(['/api/health', '/api/health/ready', '/']);
  }, 20_000);

  it('un sito che risponde 503 e rotto, e il numero d uscita e quello su cui si torna indietro', async () => {
    const sito = await accendiUnSito({ ...SANO, '/api/health/ready': { stato: 503, corpo: 'not ready' } });
    const esito = cli([sito.base], { env: SVELTE });

    expect(esito.uscita, 'Sull uscita 1 il lavoro annulla il rilascio: e questo il caso in cui deve farlo').toBe(1);
    expect(esito.stdout).toContain('e pronto a servire');
    expect(esito.stdout).toContain('503');
  }, 20_000);

  it('un sito che accetta la chiamata e non risponde piu e rotto anche lui: non si aspetta all infinito', async () => {
    const sito = await accendiUnSito({ ...SANO, '/': { stato: 200, muto: true } });
    const partito = Date.now();
    const esito = cli([sito.base], { env: SVELTE });
    const durata = Date.now() - partito;

    expect(esito.uscita, 'Un sito che tiene la linea aperta e non risponde e rotto quanto uno che risponde 500').toBe(1);
    expect(esito.stdout).toMatch(/nessuna risposta entro/i);
    expect(durata, 'Il tetto di tempo deve valere davvero: se non vale, il lavoro resta appeso').toBeLessThan(15_000);
  }, 30_000);

  it('un muro davanti al sito NON e un sito rotto: esce col numero che non fa annullare niente', async () => {
    const sito = await accendiUnSito(DIETRO_IL_MURO);
    const esito = cli([sito.base], { env: SVELTE });

    expect(
      esito.uscita,
      'Se il muro esce 1, il passo dopo annulla un rilascio sanissimo — e lo fa a ogni pubblicazione, perche il muro c e sempre',
    ).not.toBe(1);
    expect(esito.uscita, 'Serve un numero suo: rosso, ma «non ho potuto vedere»').toBe(4);
    expect(esito.stdout).toMatch(/non ho potuto vedere il sito/i);
    expect(esito.stdout).toMatch(/login di Vercel/i);
  }, 20_000);

  it('non sta un minuto a ribussare contro un muro: la risposta sarebbe la stessa', async () => {
    const sito = await accendiUnSito(DIETRO_IL_MURO);
    cli([sito.base], { env: { ...SVELTE, PROVA_TENTATIVI: '5', PROVA_ATTESA_MS: '2000' } });

    const visite = sito.visite();
    expect(
      visite.length,
      `Ha bussato ${visite.length} volte. Cinque tentativi per porta contro una schermata di accesso sono trenta secondi buttati, e la risposta non cambia`,
    ).toBe(3);
  }, 20_000);

  it('con la chiave di passaggio il muro si apre e il sito si vede davvero', async () => {
    const CHIAVE = 'chiave-finta-di-passaggio';
    const sito = await accendiUnSito(DIETRO_IL_MURO, { chiaveDiPassaggio: CHIAVE });
    const esito = cli([sito.base], { env: { ...SVELTE, VERCEL_AUTOMATION_BYPASS_SECRET: CHIAVE } });

    expect(esito.uscita, `${esito.stdout}${esito.stderr}`).toBe(0);
    expect(sito.visite().every((v) => v.passaggio === CHIAVE), 'La chiave deve viaggiare su tutte e tre le porte').toBe(true);
    expect(
      `${esito.stdout}${esito.stderr}`,
      'Un segreto stampato nel log del lavoro e un segreto regalato a chiunque abbia il repository',
    ).not.toContain(CHIAVE);
  }, 20_000);

  it('senza chiave, la stessa risposta del sito protetto resta un «non lo so»', async () => {
    const sito = await accendiUnSito(DIETRO_IL_MURO, { chiaveDiPassaggio: 'chiave-finta-di-passaggio' });
    const esito = cli([sito.base], { env: SVELTE });

    expect(esito.uscita).toBe(4);
  }, 20_000);
});

/**
 * Fin qui lo script. Qui sotto lo stesso sito finto, ma chiamato dal PASSO VERO
 * del lavoro di rilascio: la sua shell, la sua riga di comando, il numero che
 * lascia scritto per il passo del ritorno indietro.
 */
describe('il passo del rilascio che va a bussare, eseguito davvero', () => {
  const PASSO = 'Prova di fumo sul sito appena pubblicato';

  it('con il sito sano lascia scritto 0 e finisce verde', async () => {
    const sito = await accendiUnSito(SANO);
    const esito = esegui(passo(PASSO), { env: { INDIRIZZO: sito.base, ...SVELTE } });

    expect(esito.uscita, `${esito.stdout}${esito.stderr}`).toBe(0);
    expect(esito.output.codice).toBe('0');
  }, 20_000);

  it('con il sito rotto il passo fallisce: non se lo tiene per se', async () => {
    const sito = await accendiUnSito({ ...SANO, '/api/health': { stato: 500, corpo: 'boom' } });
    const esito = esegui(passo(PASSO), { env: { INDIRIZZO: sito.base, ...SVELTE } });

    expect(esito.uscita, 'Se questo passo inghiotte il rosso, il lavoro tira dritto e nessuno torna indietro').toBe(1);
    expect(esito.output.codice, 'Il numero deve restare scritto: e come il passo dopo distingue un sito rotto da un muro').toBe('1');
  }, 20_000);

  it('col muro davanti lascia scritto 4, e il ritorno indietro guarda solo l 1', async () => {
    const sito = await accendiUnSito(DIETRO_IL_MURO);
    const esito = esegui(passo(PASSO), { env: { INDIRIZZO: sito.base, ...SVELTE } });

    expect(esito.uscita, 'Rosso si: non aver visto il sito non e un successo').not.toBe(0);
    expect(esito.output.codice).toBe('4');

    const ritorno = passo('Torna indietro, il sito appena pubblicato non risponde');
    const scattaSu = (numero: string) => (ritorno.se ?? '').includes(`steps.fumo.outputs.codice == '${numero}'`);
    expect(scattaSu('1'), `La condizione del ritorno indietro e «${ritorno.se}»`).toBe(true);
    expect(
      scattaSu('4'),
      'Annullare un rilascio perche non si e potuto guardare vuol dire rompere la produzione per un dubbio',
    ).toBe(false);
  }, 20_000);
});

describe('le manopole della prova non possono spegnerla', () => {
  it('sotto i minimi si fermano ai minimi', () => {
    const manopole = manopoleDaAmbiente({ PROVA_TENTATIVI: '0', PROVA_ATTESA_MS: '-5', PROVA_TIMEOUT_MS: '1' });

    expect(manopole.tentativi, 'Zero tentativi vorrebbe dire una prova di fumo che non prova niente').toBe(1);
    expect(manopole.attesaMs).toBe(0);
    expect(manopole.timeoutMs, 'Un tetto di un millesimo boccerebbe qualunque sito, anche uno sano').toBe(1000);
  });

  it('senza manopole restano i valori di tutti i giorni', () => {
    expect(manopoleDaAmbiente({})).toMatchObject({ tentativi: 5, attesaMs: 5000, timeoutMs: 10_000, segretoDiPassaggio: '' });
  });
});
