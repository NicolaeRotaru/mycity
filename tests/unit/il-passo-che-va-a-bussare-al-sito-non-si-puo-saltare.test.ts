import { describe, it, expect } from 'vitest';
import { passiDelLavoro, passo, esegui, type Passo } from '@/tests/unit/_lavoro-di-rilascio';

/**
 * 3/9/2026 — «SI PUBBLICA E NON SI GUARDA»: IL PASSO CHE GUARDA NON DEVE POTER
 * SPARIRE IN SILENZIO.
 *
 * La prova di fianco (la-prova-di-fumo-bussa-a-un-sito-vero) mette alla prova
 * quello che il passo FA quando gira. Questa mette alla prova l'altra meta' del
 * difetto: che giri. Un controllo si spegne quasi sempre cosi', e nessuno se ne
 * accorge — gli si mette accanto un `continue-on-error`, gli si toglie il
 * rilancio del numero d'uscita, gli si aggiunge una manopola che lo addolcisce.
 * Tre modi diversi per arrivare allo stesso posto: il lavoro verde e il sito
 * rotto.
 *
 * Storia vera di questo repository, ed e' il motivo per cui questo file non si
 * accontenta di cercare una parola: fino al 31/8 il lavoro finiva verde perche'
 * ogni passo aveva una condizione che non si avverava. Ventidue esecuzioni su
 * ventidue verdi, e la prova di fumo non era mai partita nemmeno una volta.
 */

/** Il passo che va a bussare al sito appena pubblicato. */
function chiBussa(passi: Passo[]): Passo | undefined {
  return passi.find((p) => /prova-di-fumo\.mjs\s+"\$INDIRIZZO"/.test(p.run ?? ''));
}

/**
 * I modi in cui questo lavoro tornerebbe a pubblicare senza guardare. Lista
 * vuota = nessuno di quei modi e' aperto.
 */
function comeSiSpegnerebbe(passi: Passo[]): string[] {
  const guai: string[] = [];
  const bussa = chiBussa(passi);
  if (!bussa) {
    return ['Nessun passo va a bussare al sito appena pubblicato: si pubblica e non si guarda, come prima del 27/8'];
  }

  if (bussa.continuaAncheSeFallisce) {
    guai.push(
      `Il passo «${bussa.nome}» ha continue-on-error: ${bussa.continuaAncheSeFallisce}. Il sito non risponde, il passo lo sa, e il lavoro tira dritto verde lo stesso.`,
    );
  }
  if (!/exit\s+"\$CODICE"/.test(bussa.run ?? '')) {
    guai.push(`Il passo «${bussa.nome}» non rilancia il numero d'uscita della prova: il rosso muore dentro il passo`);
  }
  if (!/codice=\$CODICE/.test(bussa.run ?? '')) {
    guai.push(
      `Il passo «${bussa.nome}» non lascia scritto il numero d'uscita: senza, il ritorno indietro non sa distinguere un sito rotto (1) da un muro (4) e da un indirizzo storto (3)`,
    );
  }
  const manopole = Object.keys(bussa.ambiente).filter((chiave) => chiave.startsWith('PROVA_'));
  if (manopole.length) {
    guai.push(
      `Il passo «${bussa.nome}» addomestica la prova con ${manopole.join(', ')}: i tempi della verifica si decidono nello script, non qui`,
    );
  }

  const verdetto = passi.find((p) => (p.se ?? '').includes('always()') && /--verdetto/.test(p.run ?? ''));
  if (!verdetto) {
    guai.push('Se il passo che bussa viene saltato non lo dice nessuno: manca il verdetto che gira comunque');
  }
  return guai;
}

describe('il passo che va a bussare al sito non si puo saltare in silenzio', () => {
  it('nel lavoro vero non c e nessuna di quelle strade aperte', () => {
    expect(comeSiSpegnerebbe(passiDelLavoro()), 'Da qui si torna a pubblicare senza guardare').toEqual([]);
  });

  /**
   * Un controllo che non sa riconoscere il difetto da cui nasce non protegge
   * nessuno: qui il lavoro viene rotto nei quattro modi in cui si romperebbe
   * davvero, e ogni volta il controllo deve accorgersene.
   */
  const rompi = (comeRompo: (p: Passo) => Passo) => {
    const passi = passiDelLavoro();
    const bersaglio = chiBussa(passi)!;
    return passi.map((p) => (p.nome === bersaglio.nome ? comeRompo(p) : p));
  };

  it('il controllo riconosce il passo tolto', () => {
    const passi = passiDelLavoro();
    const mutilato = passi.filter((p) => p.nome !== chiBussa(passi)!.nome);

    expect(mutilato.length, 'Se non ho tolto niente, questa prova non prova niente').toBe(passi.length - 1);
    expect(comeSiSpegnerebbe(mutilato).join(' ')).toMatch(/non si guarda/i);
  });

  it('il controllo riconosce il «vai avanti anche se fallisce»', () => {
    const rotto = rompi((p) => ({ ...p, continuaAncheSeFallisce: 'true' }));
    expect(comeSiSpegnerebbe(rotto).join(' ')).toMatch(/continue-on-error/i);
  });

  it('il controllo riconosce il numero d uscita inghiottito', () => {
    const rotto = rompi((p) => ({ ...p, run: (p.run ?? '').replace(/exit "\$CODICE"/, 'exit 0') }));
    expect(comeSiSpegnerebbe(rotto).join(' ')).toMatch(/non rilancia il numero/i);
  });

  it('il controllo riconosce la manopola che accorcia la verifica', () => {
    const rotto = rompi((p) => ({ ...p, ambiente: { ...p.ambiente, PROVA_TENTATIVI: '1' } }));
    expect(comeSiSpegnerebbe(rotto).join(' ')).toMatch(/addomestica la prova/i);
  });

  /**
   * L'altra meta': se il passo che bussa non gira — perche' e' stato saltato,
   * perche' il rilascio non e' arrivato a un indirizzo — il lavoro non puo'
   * finire verde. Qui il verdetto viene ESEGUITO, non letto.
   */
  it('se la prova non e girata, il verdetto non lascia passare il lavoro per buono', () => {
    const esito = esegui(passo('Il verdetto — cosa ho provato davvero'), {
      env: { PRONTO: 'true', INDIRIZZO: 'https://mycity-abc.vercel.app', CODICE_FUMO: '', TORNATO: '' },
    });

    expect(esito.uscita, 'Nessuno e andato a controllare: questo non e un successo').not.toBe(0);
    expect(esito.riepilogo).toMatch(/non ho provato niente/i);
  });

  it('col muro davanti il verdetto dice che non ha visto il sito, e come si apre', () => {
    const esito = esegui(passo('Il verdetto — cosa ho provato davvero'), {
      env: { PRONTO: 'true', INDIRIZZO: 'https://mycity-abc.vercel.app', CODICE_FUMO: '4', TORNATO: '' },
    });

    expect(esito.uscita, 'Un rilascio che nessuno ha potuto guardare non e un rilascio verificato').not.toBe(0);
    expect(esito.riepilogo).toMatch(/non ho potuto vedere il sito/i);
    expect(esito.riepilogo, 'Un rosso senza la via d uscita e solo un rosso').toMatch(/VERCEL_AUTOMATION_BYPASS_SECRET/);
    expect(esito.riepilogo, 'Nessuno e tornato indietro, e dirlo e meta del messaggio').not.toMatch(/sono tornata/i);
  });
});
