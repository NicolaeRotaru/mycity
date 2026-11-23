/**
 * R18-012 — Il testo di un lavoro sul catalogo non si contraddice.
 *
 * A riga chiusa, col motivo che dice di chiedere all'assistenza prima di avviarne un altro, la riga
 * non dice «Puoi avviarne un altro». Gli altri motivi che nominano l'assistenza (il lotto chiuso dopo
 * 24 ore, lo scarto) non vietano di ripartire, e la riga continua a dirlo. I motivi sono quelli veri
 * delle rotte di app/api/ai/catalog-batch/: la prova controlla che ci siano ancora, scritti così.
 *
 * La riga «in invio» resta quella di sempre: ogni riga nasce col motivo «invio senza risposta»
 * (start/route.ts), e un invio rimasto davvero senza risposta la pagina lo mostra nel suo riquadro
 * (`incerto` dallo stato), non con questa riga.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { testoStatoLavoro } from '@/lib/ai/statoLavoroCatalogo';
import { INVIO_SENZA_RISPOSTA } from '@/lib/ai/batch';

const rotta = (nome: string) =>
  readFileSync(join(process.cwd(), 'app', 'api', 'ai', 'catalog-batch', nome, 'route.ts'), 'utf8');

/** status/route.ts: un invio senza risposta chiuso dopo 24 ore. Vieta di ripartire senza chiedere. */
const CHIUSO_INCERTO =
  "invio senza risposta da 24 ore: il lotto potrebbe essere partito ed essere stato pagato; chiedi all'assistenza prima di avviarne un altro";
/** status/route.ts: un lotto non finito entro 24 ore. Dice dove si recuperano i risultati, non vieta. */
const LOTTO_SCADUTO =
  "il lotto non e' finito entro 24 ore: chiuso. Se era partito, i risultati si recuperano con l'assistenza.";
/** cancel/route.ts: un invio senza risposta scartato dal negozio. */
const SCARTATO =
  "scartato dal negozio dopo un invio senza risposta: il lotto potrebbe essere partito ed essere stato pagato; se serve, i risultati si recuperano con l'assistenza";

const NEL_SORGENTE = (testo: string) => testo.replace(/'/g, "\\'");

describe('R18-012 i motivi usati qui sono quelli delle rotte', () => {
  it('status e cancel scrivono ancora questi motivi', () => {
    expect(rotta('status')).toContain(NEL_SORGENTE(CHIUSO_INCERTO));
    expect(rotta('status')).toContain(NEL_SORGENTE(LOTTO_SCADUTO));
    expect(rotta('cancel')).toContain(NEL_SORGENTE(SCARTATO));
  });
});

describe('R18-012 a riga chiusa la riga non dice il contrario del motivo', () => {
  it('motivo «chiedi all’assistenza prima di avviarne un altro»: niente «Puoi avviarne un altro»', () => {
    const t = testoStatoLavoro({ status: 'failed', total: 12, error: CHIUSO_INCERTO })!;
    expect(t).toMatch(/chiedi all'assistenza/);
    expect(t).not.toMatch(/Puoi avviarne un altro/i);
  });
  it('anche con lo stato «error» e l’apostrofo tipografico', () => {
    const t = testoStatoLavoro({ status: 'error', total: 12, error: CHIUSO_INCERTO.replace("'", '’') })!;
    expect(t).not.toMatch(/Puoi avviarne un altro/i);
  });
  it('lotto chiuso dopo 24 ore («si recuperano con l’assistenza»): si può ripartire, e lo dice', () => {
    expect(testoStatoLavoro({ status: 'failed', total: 12, error: LOTTO_SCADUTO })).toMatch(/Puoi avviarne un altro/);
  });
  it('lavoro scartato: lo dice annullato e che si può ripartire', () => {
    expect(testoStatoLavoro({ status: 'canceled', total: 12, error: SCARTATO })).toMatch(/Puoi avviarne un altro/);
  });
  it('un errore qualunque, o senza motivo, dice ancora «Puoi avviarne un altro»', () => {
    expect(testoStatoLavoro({ status: 'error', total: 3, error: 'x' })).toMatch(/Puoi avviarne un altro/);
    expect(testoStatoLavoro({ status: 'failed', total: 3, error: null })).toMatch(/Puoi avviarne un altro/);
  });
});

describe('R18-012 la riga «in invio» resta quella di sempre', () => {
  it('appena nata col motivo «invio senza risposta»: tra poco parte, senza mandare all’assistenza', () => {
    const t = testoStatoLavoro({ status: 'submitting', total: 12, error: INVIO_SENZA_RISPOSTA })!;
    expect(t).toContain('tra poco lo vedi partire');
    expect(t).not.toMatch(/assistenza|24 ore/);
  });
});
