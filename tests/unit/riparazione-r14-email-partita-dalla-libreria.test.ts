/**
 * R14-002 — CHI DEVE SAPERE SE L'EMAIL È PARTITA LO CHIEDE ALLA LIBRERIA DEGLI AVVISI.
 *
 * Il giro notturno, quando finisce il tempo delle email, deve sapere quali spiegazioni sono già
 * arrivate per email in una notte prima. Per saperlo si era copiato il registro degli invii e il segno
 * «partita», che nella libreria sono privati: se la libreria li cambia, la copia smette di vederli e
 * conta come «non partita» un'email già arrivata. Adesso la libreria risponde lei, leggendo lo stesso
 * registro che scrive. Database finto unico del giro notturno (chiave primaria vera), posta finta.
 */
import { describe, it, expect, vi } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';
import {
  recapitaAvvisi,
  identificativoAvviso,
  emailRisultaPartita,
  type ClienteAvvisi,
  type PostaAvvisi,
  type RegistroAvvisi,
} from '@/lib/privacy/avvisi-a-chi-aspetta';
import { verdettoDelGiro, type TentativoCancellazione } from '@/lib/cron-cancellazioni';

const ADESSO = new Date('2026-11-26T04:00:00.000Z').getTime();
const allaNotte = (n: number) => ADESSO + n * 86_400_000;

const FATTORINO: TentativoCancellazione = {
  userId: 'rider-1',
  ok: false,
  motivo: 'cassa_da_versare',
  errore: 'Cancellazione rinviata: risultano 120,00 € di contanti incassati e non ancora versati.',
  chiestaIl: new Date(ADESSO - 8 * 86_400_000).toISOString(),
};
const dovuti = () => verdettoDelGiro([FATTORINO], ADESSO, 'privacy@mycity.example').dovuti;
const registro = (): RegistroAvvisi => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const idDellAvviso = () => identificativoAvviso(dovuti()[0].chiave);

function posta(risponde: boolean): PostaAvvisi {
  return { indirizzoDi: async () => 'rider@example.com', invia: async () => ({ ok: risponde }) };
}

describe('R14-002 · l email risulta partita: lo dice la libreria che la segna', () => {
  it('partita la prima notte: risulta partita, e la notte dopo non riparte', async () => {
    const finto = fintoGiroNotturno({ chiaviUniche: true });
    const db = finto.admin as unknown as ClienteAvvisi;
    expect(dovuti()).toHaveLength(1);
    const prima = await recapitaAvvisi(db, dovuti(), registro(), posta(true), allaNotte(1));
    expect(prima.emailPartiteAvvisi).toEqual([idDellAvviso()]);
    expect(await emailRisultaPartita(db, idDellAvviso())).toBe(true);
    // La stessa lettura che fa la libreria prima di rispedire: la notte dopo nessun nuovo tentativo.
    const dopo = await recapitaAvvisi(db, dovuti(), registro(), posta(true), allaNotte(2));
    expect(dopo.emailNonPartite).toBe(0);
    expect(dopo.emailRimandate).toBe(0);
  });

  it('tentata e non partita: non risulta partita', async () => {
    const finto = fintoGiroNotturno({ chiaviUniche: true });
    const db = finto.admin as unknown as ClienteAvvisi;
    const notte = await recapitaAvvisi(db, dovuti(), registro(), posta(false), allaNotte(1));
    expect(notte.emailNonPartite).toBe(1);
    expect(await emailRisultaPartita(db, idDellAvviso())).toBe(false);
  });

  it('l email di un altro avviso non conta', async () => {
    const finto = fintoGiroNotturno({ chiaviUniche: true });
    const db = finto.admin as unknown as ClienteAvvisi;
    await recapitaAvvisi(db, dovuti(), registro(), posta(true), allaNotte(1));
    expect(await emailRisultaPartita(db, identificativoAvviso('un-altro-avviso'))).toBe(false);
  });

  it('il registro degli invii non si legge: non risulta partita, e non lancia', async () => {
    const finto = fintoGiroNotturno({ chiaviUniche: true });
    const db = finto.admin as unknown as ClienteAvvisi;
    await recapitaAvvisi(db, dovuti(), registro(), posta(true), allaNotte(1));
    finto.guasti.push({ tabella: 'audit_logs', azione: 'select', messaggio: 'connection terminated unexpectedly' });
    await expect(emailRisultaPartita(db, idDellAvviso())).resolves.toBe(false);
  });
});
