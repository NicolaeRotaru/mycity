/**
 * R05-006 — UN'EMAIL PARTITA RESTA SEGNATA, ANCHE SE IL DATABASE DICE DI NO UNA VOLTA.
 *
 * Chi aspetta la cancellazione riceve la spiegazione anche per email. Dopo l'invio la notte scrive
 * «partita» nel registro degli invii. Se quella sola scrittura cadeva (un rifiuto passeggero, il turno
 * scritto un attimo prima era andato), la notte dopo l'email ripartiva; e se il secondo invio cadeva,
 * l'allarme diceva «non partita» per un'email già arrivata. Qui la posta è finta e il database pure
 * (il finto unico del giro notturno, con la chiave primaria vera). Le pause sono su un orologio finto.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';
import {
  recapitaAvvisi,
  type ClienteAvvisi,
  type PostaAvvisi,
  type RegistroAvvisi,
} from '@/lib/privacy/avvisi-a-chi-aspetta';
import { verdettoDelGiro, type TentativoCancellazione } from '@/lib/cron-cancellazioni';

const ADESSO = new Date('2026-11-21T04:00:00.000Z').getTime();
const allaNotte = (n: number) => ADESSO + n * 86_400_000;
const SEGNO = 'privacy.avviso_cancellazione.email_partita';

const FATTORINO: TentativoCancellazione = {
  userId: 'rider-1',
  ok: false,
  motivo: 'cassa_da_versare',
  errore: 'Cancellazione rinviata: risultano 120,00 € di contanti incassati e non ancora versati.',
  chiestaIl: new Date(ADESSO - 8 * 86_400_000).toISOString(),
};
const dovuti = () => verdettoDelGiro([FATTORINO], ADESSO, 'privacy@mycity.example').dovuti;
const registro = (): RegistroAvvisi => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** Il database rifiuta la riga «partita» le prime `volte` volte, poi la prende. */
function databaseCheRifiutaIlSegno(volte: number) {
  const finto = fintoGiroNotturno({ chiaviUniche: true });
  let rifiuti = volte;
  finto.guasti.push({
    tabella: 'audit_logs',
    azione: 'insert',
    messaggio: 'connection terminated unexpectedly',
    seRiga: (r) => r.action === SEGNO && rifiuti-- > 0,
  });
  return { cliente: finto.admin as unknown as ClienteAvvisi, righe: finto.righe };
}

function postaFinta() {
  const stato = { risponde: true };
  const invia = vi.fn(async () => ({ ok: stato.risponde }));
  const posta: PostaAvvisi = { indirizzoDi: async () => 'rider@example.com', invia };
  return { posta, stato, invia };
}

/** Una notte intera, con l'orologio finto che lascia passare le pause. */
async function laNotte(db: { cliente: ClienteAvvisi }, posta: PostaAvvisi, n: number, reg = registro()) {
  const notte = recapitaAvvisi(db.cliente, dovuti(), reg, posta, allaNotte(n));
  await vi.advanceTimersByTimeAsync(10_000);
  return notte;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('R05-006 — un\'email partita resta segnata', () => {
  it('IL CASO CHE ROMPEVA — il segno «partita» cade una volta: la notte dopo l\'email non riparte e nessun allarme dice «non partita»', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const db = databaseCheRifiutaIlSegno(1);
    const p = postaFinta();

    const prima = await laNotte(db, p.posta, 1);
    expect(prima.emailPartiteAvvisi, 'la prima notte l\'email è partita').toHaveLength(1);

    p.stato.risponde = false; // la notte dopo la posta è giù
    const dopo = await laNotte(db, p.posta, 2);

    expect(p.invia, 'la spiegazione arriva una volta sola').toHaveBeenCalledTimes(1);
    expect(dopo.emailBloccate, 'nessun allarme «non partita» per un\'email già arrivata').toBe(0);
    expect(dopo.emailBloccateAvvisi).toEqual([]);
    expect(dopo.emailNonPartite).toBe(0);
    expect(dopo.emailPartiteAvvisi, 'risulta partita: un allarme rimasto aperto si chiude').toHaveLength(1);
    expect(db.righe('audit_logs').filter((r) => r.action === SEGNO), 'il segno «partita» c\'è, una riga sola').toHaveLength(1);
  });

  it('due rifiuti di fila, poi il database risponde: il segno c\'è lo stesso', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const db = databaseCheRifiutaIlSegno(2);
    const p = postaFinta();
    const reg = registro();

    await laNotte(db, p.posta, 1, reg);
    await laNotte(db, p.posta, 2);

    expect(db.righe('audit_logs').filter((r) => r.action === SEGNO)).toHaveLength(1);
    expect(p.invia).toHaveBeenCalledTimes(1);
    expect(reg.error, 'un segno arrivato al secondo tentativo non è un errore').not.toHaveBeenCalled();
  });

  it('un database che rifiuta sempre il segno: l\'email risulta partita quella notte, e il guasto resta nel registro', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const db = databaseCheRifiutaIlSegno(Number.POSITIVE_INFINITY);
    const p = postaFinta();
    const reg = registro();

    const notte = await laNotte(db, p.posta, 1, reg);

    expect(notte.emailPartiteAvvisi).toHaveLength(1);
    expect(reg.error).toHaveBeenCalledWith(
      expect.stringContaining('email partita ma non segnata'),
      expect.objectContaining({ userId: 'rider-1' }),
    );
  });
});
