import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { passiDelLavoro, passo, type Passo } from '@/tests/unit/_lavoro-di-rilascio';

/**
 * 1/9/2026 — IL PASSO SCRITTO PER DIRE SEMPRE LA VERITA' ERA L'UNICO CHE NON
 * POTEVA PARLARE.
 *
 * Il 31/8 e' stato aggiunto «Il verdetto — cosa ho provato davvero», un passo
 * `always()` che gira anche quando tutti gli altri saltano e dice cosa e' stato
 * verificato per davvero. Solo che «Checkout» era rimasto appeso a
 * `if: steps.chiavi.outputs.pronto == 'true'`: senza i segreti di Vercel il
 * repository non finiva su disco, e il verdetto — che si apre con
 * `node scripts/prova-di-fumo.mjs --verdetto` — moriva con MODULE_NOT_FOUND.
 * Nel riepilogo di Nicola non arrivava la spiegazione: arrivava una traccia di
 * stack. Visto sul serio nell'esecuzione 33523989477 del 1/9/2026.
 *
 * PERCHE' LE PROVE DI FIANCO NON L'HANNO PRESO. In
 * `il-rilascio-che-non-ha-provato-niente-non-esce-verde.test.ts` gli otto casi
 * passano tutti, e passavano anche mentre la CI era rossa: `esegui()` lancia lo
 * script del passo con `cwd` sulla radice del repository, dove
 * `scripts/prova-di-fumo.mjs` c'e' sempre. Il mondo della prova aveva il file,
 * il mondo del runner no — e la differenza fra i due mondi era esattamente il
 * difetto. Una prova che non puo' fallire nel modo in cui fallisce la realta'
 * non protegge niente.
 *
 * Quindi qui non si rilegge lo script: si guarda il WORKSPACE in cui quello
 * script verra' lanciato, che e' l'unica cosa che i due mondi non avevano in
 * comune.
 */

const NOME_VERDETTO = 'Il verdetto — cosa ho provato davvero';

/**
 * I motivi per cui questo lavoro consegnerebbe un verdetto muto. Il file che
 * serve NON e' scritto qui a mano: viene ricavato dallo script del verdetto,
 * cosi' se domani il passo chiama un altro script il controllo lo segue.
 */
function verdettoMuto(passi: Passo[]): string[] {
  const guai: string[] = [];
  const verdetto = passi.find((p) => p.nome === NOME_VERDETTO);
  if (!verdetto) return [`Non c'e' nessun passo «${NOME_VERDETTO}»`];
  if (!(verdetto.se ?? '').includes('always()')) {
    guai.push('Il verdetto non gira sempre: quando gli altri passi saltano non lo dice nessuno');
  }

  const serve = /node\s+(scripts\/[\w.-]+)/.exec(verdetto.run ?? '')?.[1];
  if (!serve) {
    guai.push('Non riesco a capire quale file del repository serva al verdetto: il controllo qui sotto non guarderebbe niente');
    return guai;
  }

  const checkout = passi.find((p) => p.nome === 'Checkout');
  if (!checkout) {
    guai.push(`Il verdetto lancia «${serve}» ma in questo lavoro non c'e' nessun Checkout: quel file non arriva su disco`);
  } else if (checkout.se) {
    guai.push(
      `Il verdetto lancia «${serve}» sempre, ma Checkout gira solo se «${checkout.se}». ` +
        'Quando quella condizione e falsa il workspace resta vuoto, il file non esiste e il verdetto esce muto.',
    );
  }
  return guai;
}

/** Lo script di un passo lanciato dove decido io, per vedere il workspace che conta. */
function lanciaIn(cartella: string, p: Passo, ambiente: Record<string, string>) {
  const riepilogo = join(mkdtempSync(join(tmpdir(), 'verdetto-')), 'riepilogo.md');
  writeFileSync(riepilogo, '');
  const esito = spawnSync('bash', ['-c', p.run!], {
    cwd: cartella,
    encoding: 'utf8',
    env: { ...process.env, ...ambiente, GITHUB_STEP_SUMMARY: riepilogo },
  });
  return { uscita: esito.status ?? -1, riepilogo: readFileSync(riepilogo, 'utf8') };
}

const SENZA_CHIAVI = { PRONTO: 'false', INDIRIZZO: '', CODICE_FUMO: '', TORNATO: '' };

describe('il verdetto trova il suo script anche quando mancano le chiavi', () => {
  it('nel lavoro vero, niente rende muto il verdetto', () => {
    expect(verdettoMuto(passiDelLavoro()), 'Il riepilogo che legge Nicola resterebbe vuoto').toEqual([]);
  });

  it('il controllo riconosce il difetto da cui nasce: rimetti la guardia a Checkout e deve bocciare', () => {
    // La forma vera del 1/9/2026, quella che ha fatto uscire MODULE_NOT_FOUND.
    const comeEra = passiDelLavoro().map((p) =>
      p.nome === 'Checkout' ? { ...p, se: "steps.chiavi.outputs.pronto == 'true'" } : p,
    );
    const guai = verdettoMuto(comeEra);
    expect(guai, 'Un controllo che non sa riconoscere il difetto da cui nasce non protegge nessuno').not.toEqual([]);
    expect(guai.join(' ')).toMatch(/workspace resta vuoto/i);
  });

  it('senza il repository su disco il verdetto esce muto — e questo e il guasto, non un dettaglio', () => {
    const vuoto = mkdtempSync(join(tmpdir(), 'workspace-senza-checkout-'));
    const esito = lanciaIn(vuoto, passo(NOME_VERDETTO), SENZA_CHIAVI);

    expect(esito.uscita, 'Rosso, si — ma per il motivo sbagliato').not.toBe(0);
    expect(esito.riepilogo.trim(), 'Nel riepilogo di Nicola non finisce NIENTE: solo una traccia di stack nel log').toBe('');
  });

  it('con il repository su disco lo stesso passo dice cosa non ha controllato, e resta rosso', () => {
    const esito = lanciaIn(process.cwd(), passo(NOME_VERDETTO), SENZA_CHIAVI);

    expect(esito.uscita, 'Zero controlli fatti non e un successo').not.toBe(0);
    expect(esito.riepilogo, 'Questa e la spiegazione che il rosso deve portarsi dietro').toMatch(/non ho provato niente/i);
    expect(esito.riepilogo).toMatch(/VERCEL_TOKEN/);
  });
});
