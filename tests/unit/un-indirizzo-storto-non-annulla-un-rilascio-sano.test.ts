import { describe, it, expect } from 'vitest';
import { passo, esegui, cli } from '@/tests/unit/_lavoro-di-rilascio';

/** Quello che il collaudo del 31/8 ha visto arrivare al posto dell indirizzo. */
const SPAZZATURA = 'Updateavailable59.10.0->62.0.1';

/**
 * 31/8/2026 (collaudo del rilascio, difetto ②) — «IL SITO E' ROTTO» E «MI HANNO DATO UNA RIGA A CASO»
 * FINIVANO NELLO STESSO ESITO.
 *
 * La prova di fumo usciva 1 in tutti e due i casi, e il lavoro sopra sa fare
 * una cosa sola quando vede 1: annullare il rilascio. Cosi' un rilascio
 * sanissimo veniva buttato via perche' in coda allo stdout della CLI c era un
 * avviso di aggiornamento. Le due situazioni hanno conseguenze opposte e devono
 * avere risposte diverse.
 */
describe('un indirizzo che non e un indirizzo non deve far annullare un rilascio sano', () => {
  it('non risponde «il sito e rotto» quando il problema e l indirizzo', () => {
    const esito = cli([SPAZZATURA]);

    expect(
      esito.uscita,
      `Con «${SPAZZATURA}» al posto dell indirizzo la prova di fumo e uscita ${esito.uscita}. Se e lo stesso numero di un sito rotto, il lavoro annulla un rilascio che stava benissimo.`,
    ).not.toBe(1);
    expect(esito.uscita, 'Serve un numero suo, che chi chiama possa riconoscere').toBe(3);
    expect(`${esito.stdout}${esito.stderr}`).toMatch(/indirizzo/i);
  });

  it('non va nemmeno a bussare: se ne accorge subito', () => {
    const esito = cli([SPAZZATURA]);
    expect(
      esito.durataMs,
      'Ripetere cinque tentativi su una stringa che non e un indirizzo vuol dire un minuto di attesa per scoprire una cosa che si vede alla prima occhiata',
    ).toBeLessThan(5000);
  });

  it('la prova di fumo lascia scritto COME e andata, non solo che e andata male', () => {
    const esito = esegui(passo('Prova di fumo sul sito appena pubblicato'), {
      env: { INDIRIZZO: SPAZZATURA },
    });

    expect(
      esito.output.codice,
      'Senza il numero d uscita annotato, il passo del ritorno indietro non puo distinguere un sito rotto da un indirizzo storto: vede solo «fallito»',
    ).toBe('3');
  });

  it('il ritorno indietro parte solo quando e il SITO a non rispondere', () => {
    const ritorno = passo('Torna indietro, il sito appena pubblicato non risponde');

    // Come GitHub valuta davvero questa condizione non si puo' provare da qui:
    // qui si prova che la condizione guarda il numero d'uscita della prova di
    // fumo e si accende solo sul numero che vuol dire «il sito e' rotto».
    expect(
      ritorno.se,
      `La condizione del ritorno indietro e «${ritorno.se}». Se guarda solo «il passo e fallito», un indirizzo storto fa annullare un rilascio sano.`,
    ).toBe("always() && steps.fumo.outputs.codice == '1'");
  });
});
