/**
 * @vitest-environment jsdom
 */

/**
 * 27/8/2026 (R091) — «SCRIVI IL PRIMO MESSAGGIO» A CHI NE AVEVA GIÀ SCRITTI VENTI.
 *
 * Nello stesso file la lettura della CONVERSAZIONE era già scritta bene, con tre stati diversi:
 * sto arrivando · non riesco a leggerla (col pulsante Riprova) · non c'è. La lettura dei
 * MESSAGGI, venti righe più sotto, era `const { data: messages = [] } = useQuery({...})` e basta.
 * La funzione di lettura fa `if (error) throw error`, quindi fallisce sul serio: `data` resta
 * indefinito, il ripiego `= []` prende il suo posto, e la chat si presentava vuota con sotto
 * «Scrivi il primo messaggio per iniziare la conversazione.»
 *
 * Chi legge quella frase non pensa «la rete non va»: pensa che i messaggi siano stati cancellati,
 * o che l'altro non abbia mai scritto. È il canale su cui negozio e cliente si fidano l'uno
 * dell'altro, e lo svuotava un errore di rete.
 *
 * La pagina qui viene montata per davvero, con la lettura dei messaggi in errore.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';
import { attendi } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;

const CONVERSAZIONE = {
  id: 'c1',
  buyer_id: 'u1',
  seller_id: 'v1',
  buyer: { full_name: 'Marta Rossi', store_name: null },
  seller: { full_name: null, store_name: 'Pane Quotidiano' },
};

/** La chiave della lettura dei MESSAGGI è `['messages', id]`; quella della conversazione ha tre pezzi. */
const eLaListaDeiMessaggi = (chiave: unknown[]) => chiave.length === 2 && chiave[0] === 'messages';

function daiLaConversazione(o: { queryKey: unknown[] }) {
  if (eLaListaDeiMessaggi(o.queryKey)) return [];
  return CONVERSAZIONE;
}

/** Monta il filo con l'utente collegato e aspetta che l'effetto di accesso sia passato. */
async function apriIlFilo() {
  const mod = await monta('app/messages/[id]/page.tsx');
  const s = accendi(mod.default, { params: { id: 'c1' } });
  await attendi();
  return s;
}

describe('il filo dei messaggi', () => {
  beforeEach(() => {
    globali.__UTENTE__ = { id: 'u1' };
    globali.__DATI_QUERY__ = daiLaConversazione;
    globali.__ESITO_QUERY__ = undefined;
  });

  afterEach(() => {
    globali.__UTENTE__ = undefined;
    globali.__DATI_QUERY__ = undefined;
    globali.__ESITO_QUERY__ = undefined;
  });

  it('su una conversazione letta e davvero senza messaggi invita a scrivere il primo', async () => {
    // Il verde di controllo: se un giorno la frase sparisce, la prova qui sotto smette di
    // misurare qualcosa e deve dirlo.
    const s = await apriIlFilo();
    expect(
      s.radice.textContent,
      'la frase dello stato vuoto non c\'è più: la prova sull\'errore non misura più niente',
    ).toContain('Scrivi il primo messaggio');
    s.smonta();
  }, 60000);

  it('con i messaggi non letti NON dice che la conversazione è da iniziare', async () => {
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      eLaListaDeiMessaggi(o.queryKey)
        ? { isError: true, error: new Error('rete caduta'), data: undefined, isSuccess: false }
        : undefined;

    const s = await apriIlFilo();
    const aSchermo = s.radice.textContent ?? '';

    expect(
      aSchermo,
      'La chat si svuota davanti agli occhi: chi legge pensa che i messaggi siano stati cancellati',
    ).not.toContain('Scrivi il primo messaggio');
    expect(
      aSchermo,
      'Nessuno dice che è la lettura a non essere riuscita: la conversazione sembra sparita',
    ).toContain('Non riesco a caricare i messaggi');
    s.smonta();
  }, 60000);

  it('con i messaggi non letti offre di riprovare, e il pulsante rilegge davvero', async () => {
    let riletture = 0;
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      eLaListaDeiMessaggi(o.queryKey)
        ? {
            isError: true, error: new Error('rete caduta'), data: undefined, isSuccess: false,
            refetch: () => { riletture += 1; return Promise.resolve({ data: undefined }); },
          }
        : undefined;

    const s = await apriIlFilo();
    const riprova = Array.from(s.radice.querySelectorAll('button')).find((b) =>
      /riprova/i.test(b.textContent ?? ''),
    );
    expect(riprova, 'Non c\'è modo di riprovare: resta solo uscire dalla conversazione').toBeTruthy();

    s.agisci(() => clicca(riprova!));
    expect(riletture, 'Il pulsante «Riprova» c\'è ma non rilegge niente: è un pulsante finto').toBeGreaterThan(0);
    s.smonta();
  }, 60000);
});
