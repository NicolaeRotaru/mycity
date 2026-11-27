/**
 * R25-005 — SE IL REGISTRO DEGLI INVII NON SI LEGGE, L'ALLARME NON DICE «NON PARTITA».
 *
 * Con il registro che non si legge l'email non si tenta (per non spedirla ogni notte) e prima
 * l'esito era `bloccata`, lo stesso dei trentuno tentativi finiti male: l'allarme diceva «non è
 * partita per email, e non è un intoppo di una notte sola» anche alla prima notte e per un'email
 * forse già arrivata. Adesso il rapporto porta `registroIlleggibile`, distinto da `forsePartita` e
 * dal «non partita»: chi scrive l'allarme può dire che non si sa. Database e posta finti.
 */
import { describe, it, expect, vi } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';
import {
  recapitaAvvisi,
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

function postaFinta(risponde: boolean) {
  const invia = vi.fn(async () => ({ ok: risponde }));
  const posta: PostaAvvisi = { indirizzoDi: async () => 'rider@example.com', invia };
  return { posta, invia };
}

describe('R25-005 — registro degli invii illeggibile', () => {
  it('IL CASO CHE ROMPEVA — la prima notte, col registro che non si legge: l\'allarme porta «non si sa», non «non partita»', async () => {
    const finto = fintoGiroNotturno({ chiaviUniche: true });
    finto.guasti.push({ tabella: 'audit_logs', azione: 'select', messaggio: 'connection terminated unexpectedly' });
    const p = postaFinta(true);

    const rapporto = await recapitaAvvisi(finto.admin as unknown as ClienteAvvisi, dovuti(), registro(), p.posta, allaNotte(1));

    expect(p.invia, 'senza registro l\'email non si tenta').not.toHaveBeenCalled();
    expect(rapporto.emailBloccate, 'la notte resta rossa: qualcuno deve guardare').toBe(1);
    expect(rapporto.emailBloccateAvvisi).toHaveLength(1);
    expect(rapporto.emailBloccateAvvisi[0].registroIlleggibile).toBe(true);
    expect(rapporto.emailBloccateAvvisi[0].forsePartita, 'non è «forse partita»: il registro non mostra nessun tentativo').toBeUndefined();
  });

  it('il registro prende il turno ma poi si rompe la scrittura: stesso «non si sa»', async () => {
    const finto = fintoGiroNotturno({ chiaviUniche: true });
    finto.guasti.push({ tabella: 'audit_logs', azione: 'insert', messaggio: 'connection terminated unexpectedly' });
    const rapporto = await recapitaAvvisi(finto.admin as unknown as ClienteAvvisi, dovuti(), registro(), postaFinta(true).posta, allaNotte(1));
    expect(rapporto.emailBloccateAvvisi[0]?.registroIlleggibile).toBe(true);
  });

  it('il registro si legge e la posta dice di no la prima notte: «non partita», senza il segno «non si sa»', async () => {
    const finto = fintoGiroNotturno({ chiaviUniche: true });
    const rapporto = await recapitaAvvisi(finto.admin as unknown as ClienteAvvisi, dovuti(), registro(), postaFinta(false).posta, allaNotte(1));
    expect(rapporto.emailNonPartite).toBe(1);
    expect(rapporto.emailBloccateAvvisi).toEqual([]);
  });
});
