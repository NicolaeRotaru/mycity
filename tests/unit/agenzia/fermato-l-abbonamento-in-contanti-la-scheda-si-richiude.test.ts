import { describe, it, expect } from 'vitest';
import { schedaComeLaVedeIlNegozio } from '@/lib/agenzia/scheda-del-negozio';
import { schedaEPagellaAperte, statoCheApre } from '@/lib/agenzia/scheda-dopo-abbonamento';

/**
 * FERMATO L'ABBONAMENTO IN CONTANTI, LA SCHEDA SI RICHIUDE — collaudo del 27/11/2026.
 *
 * Al «Sì» dell'agente la pagina del negozio si sblocca con un abbonamento in contanti (migrazione 999), prima
 * dei soldi. Se il titolare non paga, Nicola preme «Ferma l'abbonamento»: la vetrina si chiudeva, ma scheda e
 * rapporto restavano per sempre, perché una riga chiusa contava come «ha pagato almeno una volta». Ora un
 * abbonamento in contanti fermato non apre niente; uno Stripe pagato e poi disdetto la tiene aperta, come prima.
 */

const scheda = {
  tipo: 'scheda-cliente',
  id_attivita: '0de1905e-7000-4000-8000-0000000000ff',
  campi: { indirizzo: { valore: 'Via Roma 1, Piacenza', stato: 'confermato', fonte: 'https://www.eltropicolatino.it/contatti' } },
};
const campi = (abbonamenti: { fascia?: string; stato: string; origine?: string }[]) =>
  Object.keys(schedaComeLaVedeIlNegozio(scheda, { visibileSenzaAbbonamento: false, abbonamenti })?.campi ?? {});

describe('la scheda del negozio dopo «Ferma l abbonamento»', () => {
  it('in contanti in corso è aperta; fermato si richiude', () => {
    expect(campi([{ fascia: 'premium', stato: 'active', origine: 'contanti' }])).toEqual(['indirizzo']);
    expect(campi([{ fascia: 'premium', stato: 'canceled', origine: 'contanti' }])).toEqual([]);
  });

  it('uno pagato online e poi disdetto la tiene aperta, come prima; una riga senza origine è Stripe', () => {
    expect(campi([{ fascia: 'base', stato: 'canceled', origine: 'stripe' }])).toEqual(['indirizzo']);
    expect(campi([{ fascia: 'base', stato: 'canceled' }])).toEqual(['indirizzo']);
  });

  it('la regola da sola', () => {
    expect(statoCheApre({ stato: 'canceled', origine: 'contanti' })).toBeNull();
    expect(statoCheApre({ stato: 'past_due', origine: 'contanti' })).toBe('past_due');
    expect(schedaEPagellaAperte({ visibileSenzaAbbonamento: false, statiAbbonamenti: [statoCheApre({ stato: 'canceled', origine: 'contanti' })] })).toBe(false);
  });
});
