/**
 * I TRE ABBONAMENTI COME PRODOTTI NELLA VETRINA DI SDG AGENZIA — 24/11/2026.
 *
 * Nicola: «metti i tre abbonamenti come prodotti nella vetrina di SDG». Il nome, il prezzo e la
 * descrizione vengono dal listino (`FASCE`): la migrazione 707 li scrive nel database, e la prova
 * tests/unit/sdg-nel-marketplace.test.ts controlla che dicano le stesse cose di questo file.
 * Se un giorno cambia il listino, cambiano tutti e due insieme.
 */
import { ABBONAMENTI, FASCE, FRASE_CONDIZIONI, FRASE_PARTNER, LISTINO, SERVIZI_AGENZIA, type Abbonamento } from './preventivo';

/** Gli id fissi dei tre prodotti, uguali nella migrazione 707. */
export const ID_PRODOTTO_SDG: Record<Abbonamento, string> = {
  base: '11111111-1111-1111-1111-5d9000000101',
  business: '11111111-1111-1111-1111-5d9000000102',
  premium: '11111111-1111-1111-1111-5d9000000103',
};

export type ProdottoSdg = { id: string; fascia: Abbonamento; nome: string; prezzoEuro: string; descrizione: string };

const euro = (centesimi: number) => (centesimi / 100).toFixed(2);
const euroParlato = (centesimi: number) =>
  `${(centesimi / 100).toLocaleString('it-IT', { minimumFractionDigits: centesimi % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;

export function prodottoSdg(fascia: Abbonamento): ProdottoSdg {
  const f = FASCE[fascia];
  const righe = SERVIZI_AGENZIA.map((s) => `· ${LISTINO[s].titolo}: ${f.servizi[s]}`);
  const descrizione = [
    f.perChi,
    '',
    'Cosa comprende:',
    ...righe,
    `· Vetrina: ${f.vetrina}`,
    `· Assistenza: ${f.assistenza}`,
    '',
    `Si attiva dalla pagina Abbonamento del tuo negozio, non dal carrello. ${FRASE_CONDIZIONI}`,
    FRASE_PARTNER,
  ].join('\n');
  return {
    id: ID_PRODOTTO_SDG[fascia],
    fascia,
    nome: `Abbonamento ${f.nome} — ${euroParlato(f.prezzoMese)} al mese`,
    prezzoEuro: euro(f.prezzoMese),
    descrizione,
  };
}

export const PRODOTTI_SDG: readonly ProdottoSdg[] = ABBONAMENTI.map(prodottoSdg);
