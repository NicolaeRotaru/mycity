/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca, attendi } from './aiuti/schermo';

/**
 * 6/9/2026 — TRE PAGINE CHE, QUANDO LA LETTURA CADE, DICONO UNA COSA FALSA.
 *
 * ① «Gift card» e ② «Punti» leggono il credito cosi': `const { data } = await
 *    supabase…single(); return data?.wallet_balance_cents ?? 0`. L'errore non
 *    veniva raccolto, quindi una lettura caduta non diventava un errore:
 *    diventava il numero 0, e per il contenitore delle query era una lettura
 *    RIUSCITA — nessun secondo tentativo, nessun avviso, e lo zero finto in
 *    cache sotto la chiave del portafoglio, che le due pagine dividono. Una
 *    cliente con 25 euro di gift card leggeva «0,00 €» come chi il credito non
 *    ce l'ha davvero.
 * ③ «Messaggi» prendeva solo `isLoading`: con la lettura caduta il caricamento
 *    e' finito e l'elenco e' vuoto, quindi usciva «Nessuna conversazione» a chi
 *    le conversazioni ce le ha.
 *
 * Le pagine qui si montano per davvero, con la lettura in errore.
 */

const globali = globalThis as Record<string, unknown>;

const eIlPortafoglio = (chiave: unknown) => Array.isArray(chiave) && chiave[0] === 'wallet';
const rete = () => ({ isError: true, error: new Error('rete caduta'), data: undefined, isSuccess: false });

beforeEach(() => {
  globali.__UTENTE__ = { id: 'u1', email: 'chi@prova.it' };
  globali.__DATI_QUERY__ = undefined;
  globali.__ESITO_QUERY__ = undefined;
});

afterEach(() => {
  document.body.innerHTML = '';
  globali.__UTENTE__ = undefined;
  globali.__DATI_QUERY__ = undefined;
  globali.__ESITO_QUERY__ = undefined;
});

async function apri(pagina: string) {
  const mod = await monta(pagina);
  const s = accendi(mod.default);
  await attendi();
  await attendi();
  return s;
}

describe('il credito, nella pagina delle gift card', () => {
  beforeEach(() => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (eIlPortafoglio(o.queryKey) ? 2500 : []);
  });

  it('quando si legge, si legge: venticinque euro sono venticinque euro', async () => {
    // Il verde di controllo: se domani la cifra sparisce dalla pagina, la prova
    // sull'errore qui sotto non misura piu' niente e deve dirlo.
    const s = await apri('app/profile/gift-cards/page.tsx');
    expect(s.radice.textContent, 'il saldo non si vede piu\' nella pagina').toContain('25,00');
    s.smonta();
  }, 60000);

  it('quando NON si legge, non esce «0,00 €»: esce che non si e\' riusciti', async () => {
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) => (eIlPortafoglio(o.queryKey) ? rete() : undefined);
    const s = await apri('app/profile/gift-cards/page.tsx');
    const aSchermo = s.radice.textContent ?? '';

    expect(aSchermo, 'il credito non letto viene mostrato come credito a zero').not.toContain('0,00');
    expect(aSchermo, 'nessuno dice che e\' la lettura a non essere riuscita').toContain('Non riusciamo a leggere il tuo credito');
    s.smonta();
  }, 60000);

  it('e offre di riprovare, con un pulsante che rilegge davvero', async () => {
    let riletture = 0;
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      eIlPortafoglio(o.queryKey)
        ? { ...rete(), refetch: () => { riletture += 1; return Promise.resolve({ data: undefined }); } }
        : undefined;

    const s = await apri('app/profile/gift-cards/page.tsx');
    const riprova = Array.from(s.radice.querySelectorAll('button')).find((b) => /riprova/i.test(b.textContent ?? ''));
    expect(riprova, 'non c\'e\' modo di riprovare: resta solo ricaricare la pagina').toBeTruthy();
    s.agisci(() => clicca(riprova!));
    expect(riletture, 'il pulsante «Riprova» non rilegge niente: e\' un pulsante finto').toBeGreaterThan(0);
    s.smonta();
  }, 60000);
});

describe('il credito, nella pagina dei punti', () => {
  beforeEach(() => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => {
      if (eIlPortafoglio(o.queryKey)) return 2500;
      if (Array.isArray(o.queryKey) && o.queryKey[1] === 'account') {
        return { points_balance: 120, tier: 'bronze', lifetime_points: 120, current_streak_days: 1 };
      }
      return [];
    };
  });

  it('con la lettura riuscita dice quanto credito c\'e\' gia\'', async () => {
    const s = await apri('app/profile/loyalty/page.tsx');
    expect(s.radice.textContent, 'la frase sul credito gia\' disponibile non c\'e\' piu\'').toContain('Hai già');
    s.smonta();
  }, 60000);

  it('con la lettura caduta non fa sparire il credito in silenzio', async () => {
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) => (eIlPortafoglio(o.queryKey) ? rete() : undefined);
    const s = await apri('app/profile/loyalty/page.tsx');
    const aSchermo = s.radice.textContent ?? '';
    expect(aSchermo, 'la frase sul credito sparisce e nessuno dice perche\'').toContain('non riusciamo a leggerlo');
    expect(aSchermo).not.toContain('Hai già');
    s.smonta();
  }, 60000);
});

describe('l\'elenco dei messaggi', () => {
  beforeEach(() => { globali.__DATI_QUERY__ = () => []; });

  it('davvero vuoto, invita a scrivere al negozio', async () => {
    const s = await apri('app/messages/page.tsx');
    expect(s.radice.textContent, 'lo stato vuoto non c\'e\' piu\': la prova sull\'errore non misura niente')
      .toContain('Nessuna conversazione');
    s.smonta();
  }, 60000);

  it('con la lettura caduta NON dice che non hai conversazioni', async () => {
    globali.__ESITO_QUERY__ = () => rete();
    const s = await apri('app/messages/page.tsx');
    const aSchermo = s.radice.textContent ?? '';
    expect(aSchermo, 'chi ha dieci conversazioni aperte legge che non ne ha nessuna').not.toContain('Nessuna conversazione');
    expect(aSchermo, 'nessuno dice che e\' la lettura a non essere riuscita').toContain('Non riusciamo a caricare i messaggi');
    s.smonta();
  }, 60000);

  it('e il pulsante «Riprova» rilegge davvero', async () => {
    let riletture = 0;
    globali.__ESITO_QUERY__ = () => ({
      ...rete(), refetch: () => { riletture += 1; return Promise.resolve({ data: undefined }); },
    });
    const s = await apri('app/messages/page.tsx');
    const riprova = Array.from(s.radice.querySelectorAll('button')).find((b) => /riprova/i.test(b.textContent ?? ''));
    expect(riprova, 'non c\'e\' modo di riprovare la lettura dei messaggi').toBeTruthy();
    s.agisci(() => clicca(riprova!));
    expect(riletture, 'il pulsante «Riprova» dei messaggi non rilegge niente').toBeGreaterThan(0);
    s.smonta();
  }, 60000);
});
