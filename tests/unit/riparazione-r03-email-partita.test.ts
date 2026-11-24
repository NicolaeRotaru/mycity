/**
 * R03-002 — EMAIL PARTITA MA NON SEGNATA: L'ALLARME NON DICE «NON PARTITA».
 *
 * La prima notte la spiegazione parte per email, ma il segno «partita» nel registro degli invii non
 * si scrive (il database dice di no anche alle pause del segno). La notte dopo il tentativo è il
 * secondo: l'email riparte (meglio due volte che nessuna) e, se quell'invio cade, l'esito era
 * «bloccata»: l'allarme agli amministratori diceva «non è partita per email» per un'email già
 * arrivata. Adesso anche il no si segna, e un tentativo senza esito rende l'email `forsePartita`:
 * chi scrive l'allarme sa che può dire solo «non risulta partita».
 *
 * Il finto database è quello unico del giro notturno (legge quello che scrive, la chiave primaria
 * rifiuta il doppione); l'orologio è finto: l'ora di ogni notte si passa al giro, e le pause del
 * segno girano su timer finti.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';
import {
  recapitaAvvisi,
  type ClienteAvvisi,
  type PostaAvvisi,
  type RapportoAvvisi,
  type RegistroAvvisi,
} from '@/lib/privacy/avvisi-a-chi-aspetta';
import { verdettoDelGiro, type TentativoCancellazione } from '@/lib/cron-cancellazioni';

const ADESSO = new Date('2026-11-24T04:00:00.000Z').getTime();
const allaNotte = (n: number) => ADESSO + n * 86_400_000;
const giorniFa = (g: number) => new Date(ADESSO - g * 86_400_000).toISOString();

const FATTORINO: TentativoCancellazione = {
  userId: 'rider-1',
  ok: false,
  motivo: 'cassa_da_versare',
  errore: 'Cancellazione rinviata: risultano 120,00 € di contanti incassati e non ancora versati.',
  chiestaIl: giorniFa(8),
};
const dovuti = () => verdettoDelGiro([FATTORINO], ADESSO, 'privacy@mycity.example').dovuti;
const registro = (): RegistroAvvisi => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const EMAIL_PARTITA = 'privacy.avviso_cancellazione.email_partita';
const EMAIL_TENTATA = 'privacy.avviso_cancellazione.email_tentata';

function scena() {
  const finto = fintoGiroNotturno({ chiaviUniche: true });
  const stato = { risponde: true };
  const invia = vi.fn(async () => ({ ok: stato.risponde }));
  const posta: PostaAvvisi = { indirizzoDi: async () => 'rider@example.com', invia };
  /** Il registro degli invii rifiuta il segno «partita» (e solo quello). */
  const segnoRifiutato = () =>
    finto.guasti.push({
      tabella: 'audit_logs',
      azione: 'insert',
      messaggio: 'canceling statement due to statement timeout',
      seRiga: (r) => r.action === EMAIL_PARTITA,
    });
  const segnoDiNuovoBuono = () => finto.guasti.splice(0, finto.guasti.length);
  return { finto, cliente: finto.admin as unknown as ClienteAvvisi, posta, stato, invia, segnoRifiutato, segnoDiNuovoBuono };
}

/** Un giro alla notte `n`, con le pause del segno che passano sui timer finti. */
async function notte(s: ReturnType<typeof scena>, n: number): Promise<RapportoAvvisi> {
  const giro = recapitaAvvisi(s.cliente, dovuti(), registro(), s.posta, allaNotte(n));
  await vi.runAllTimersAsync();
  return giro;
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('R03-002 email partita ma non segnata', () => {
  it('IL CASO: partita la prima notte senza segno, la seconda non riparte → l allarme sa che forse è partita', async () => {
    const s = scena();
    s.segnoRifiutato();
    const prima = await notte(s, 1);
    expect(s.invia, 'la prima notte l email parte').toHaveBeenCalledTimes(1);
    expect(prima.emailPartiteAvvisi).toHaveLength(1);
    expect(s.finto.righe('audit_logs').some((r) => r.action === EMAIL_PARTITA), 'il segno non c è').toBe(false);

    s.segnoDiNuovoBuono();
    s.stato.risponde = false;
    const seconda = await notte(s, 2);
    expect(s.invia, 'la seconda notte riparte (meglio due volte che nessuna)').toHaveBeenCalledTimes(2);
    expect(seconda.emailBloccate, 'resta un allarme: nessuno sa se è arrivata').toBe(1);
    expect(seconda.emailBloccateAvvisi).toHaveLength(1);
    expect(
      seconda.emailBloccateAvvisi[0].forsePartita,
      'la prima notte è partita: l allarme non può dire «non è partita per email»',
    ).toBe(true);
  });

  it('due notti di posta che dice di no: l email NON è partita, e l allarme lo dice come prima', async () => {
    const s = scena();
    s.stato.risponde = false;
    const prima = await notte(s, 1);
    expect(prima.emailNonPartite).toBe(1);
    expect(prima.emailBloccate, 'un intoppo di una notte non sveglia nessuno').toBe(0);
    const seconda = await notte(s, 2);
    expect(seconda.emailBloccate).toBe(1);
    expect(seconda.emailBloccateAvvisi[0].forsePartita, 'tutti e due i tentativi sono un no segnato').toBeUndefined();
  });

  it('partita senza segno e la notte dopo ripartita bene: chiusa, nessun allarme', async () => {
    const s = scena();
    s.segnoRifiutato();
    await notte(s, 1);
    s.segnoDiNuovoBuono();
    const seconda = await notte(s, 2);
    expect(seconda.emailBloccate).toBe(0);
    expect(seconda.emailPartiteAvvisi).toHaveLength(1);
    const terza = await notte(s, 3);
    expect(s.invia, 'segnata la seconda volta, la terza notte non riparte').toHaveBeenCalledTimes(2);
    expect(terza.emailBloccate).toBe(0);
  });

  it('un tentativo scritto prima di questa correzione (senza il segno del no) resta come era: «non partita»', async () => {
    const s = scena();
    // La spiegazione è già nel pannello (senza posta), e nel registro c'è un turno di prima:
    // niente `segnaIlNo`, niente «fallita», niente «partita».
    await recapitaAvvisi(s.cliente, dovuti(), registro(), undefined, allaNotte(1));
    const id = s.finto.righe('notifications')[0]?.id;
    expect(id).toBeTruthy();
    s.finto.db.audit_logs = [{
      id: 'vecchio-turno-1', action: EMAIL_TENTATA, target_table: 'notifications', target_id: id,
      metadata: { tappa: 'rinviata', tentativo: 1, presoIl: new Date(allaNotte(1)).toISOString() },
    }];
    s.stato.risponde = false;
    const seconda = await notte(s, 2);
    expect(seconda.emailBloccate).toBe(1);
    expect(seconda.emailBloccateAvvisi[0].forsePartita).toBeUndefined();
  });
});
