import { describe, it, expect } from 'vitest';
import { esegui, passo, SEGRETI_FINTI, INDIRIZZO_DI_PRIMA } from './_lavoro-di-rilascio';

/**
 * R09-001 — Se il sito nuovo non risponde il rilascio torna indietro col codice, ma il database resta
 * avanti (le migrazioni si applicano prima di pubblicare). L'avviso in cima e il titolo del riepilogo
 * dicevano «torno a …» e «Rilascio annullato», e il verdetto in fondo «sono tornata al rilascio di
 * prima»: chi leggeva solo quelli credeva la produzione tornata com'era. Adesso dicono che è tornato
 * indietro solo il codice, e quali migrazioni di questo giro restano applicate.
 * Il passo vero del lavoro di rilascio, eseguito con `npx` finto (tests/unit/_lavoro-di-rilascio.ts).
 *
 * Quello che resta (il ritorno vero del database) è una scelta di Nicola.
 */
const PASSO = 'Torna indietro, il sito appena pubblicato non risponde';

function ritorno(env: Record<string, string>) {
  return esegui(passo(PASSO), { env: { ...SEGRETI_FINTI, PRECEDENTE: INDIRIZZO_DI_PRIMA, ...env } });
}

describe('il ritorno indietro dice che torna solo il codice', () => {
  it('con due migrazioni applicate nel giro: l\'avviso in cima e il titolo dicono che il database resta avanti, e quali', () => {
    const e = ritorno({ MIGRAZIONI: '2', MIGRAZIONI_ELENCO: '095_cron_heartbeats.sql 105_remove_invoicing.sql ' });
    expect(e.uscita).toBe(0);
    expect(e.output.tornato).toBe('si');

    const avviso = e.stdout.split('\n').find((r) => r.startsWith('::error::')) ?? '';
    expect(avviso, `l'avviso in cima non dice che il database resta avanti: ${avviso}`).toMatch(/database NON torna indietro/);
    expect(avviso).toMatch(/avanti di 2 migrazioni/);
    expect(avviso).toMatch(/095_cron_heartbeats\.sql 105_remove_invoicing\.sql\)/);
    expect(avviso).toMatch(/torno al codice di/);

    const titolo = e.riepilogo.split('\n').find((r) => r.startsWith('## ')) ?? '';
    expect(titolo, `il titolo del riepilogo fa credere che sia tornato tutto: ${titolo}`).toMatch(/solo il codice/);
    const frase = e.riepilogo.split('\n').find((r) => r.includes('sono tornata al rilascio')) ?? '';
    expect(frase).toMatch(/solo col CODICE: il database NON torna indietro: resta avanti di 2 migrazioni/);
    expect(frase).toContain(INDIRIZZO_DI_PRIMA);
  });

  it('senza migrazioni nel giro lo dice, senza inventare un database avanti', () => {
    const zero = ritorno({ MIGRAZIONI: '0', MIGRAZIONI_ELENCO: '' });
    expect(zero.stdout).toMatch(/::error::.*torno al codice di .*il database non torna indietro \(in questo giro non c'erano migrazioni nuove\)/);
    expect(zero.riepilogo).not.toMatch(/avanti di/);

    const nessuna = ritorno({ MIGRAZIONI: '', MIGRAZIONI_ELENCO: '' });
    expect(nessuna.stdout).toMatch(/::error::.*in questo giro non ho applicato migrazioni/);
  });

  it('il verdetto in fondo dice che è tornato solo il codice, e dove leggere le migrazioni', () => {
    const v = esegui(passo('Il verdetto — cosa ho provato davvero'), {
      env: { PRONTO: 'true', INDIRIZZO: 'https://mycity-abc.vercel.app', CODICE_FUMO: '1', TORNATO: 'si' },
    });
    expect(v.uscita).not.toBe(0);
    expect(v.riepilogo).toMatch(/sono tornata/i);
    expect(v.riepilogo, 'il verdetto dice «sono tornata al rilascio di prima» e basta').toMatch(/solo col codice/);
    expect(v.riepilogo).toMatch(/Il database non torna indietro/);
    expect(v.riepilogo).toMatch(/Torna indietro/);
  });
});
