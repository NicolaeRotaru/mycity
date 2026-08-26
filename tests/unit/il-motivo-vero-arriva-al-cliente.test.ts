import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import { ApiErrors } from '@/lib/api/responses';

/**
 * QUANDO NON PUOI ANNULLARE UN ORDINE, IL MOTIVO VERO DEVE ARRIVARTI
 * (radiografia del design, 22/8/2026).
 *
 * Il server scriveva messaggi precisi e utili: «Il negozio ha già accettato
 * l ordine, non puoi più annullarlo.», «Ordine già incassato in contanti: scrivi
 * all assistenza per la restituzione.» Nessuno dei due arrivava al cliente.
 *
 * La catena, per intero:
 *   ① il corpo di ApiErrors è `{ ok:false, error:{ code, message } }` — `error` è
 *      un OGGETTO;
 *   ② il client faceva `new Error(corpo.error || '…')`: l'oggetto è truthy, quindi
 *      il messaggio diventava la stringa «[object Object]»;
 *   ③ `friendlyError` scarta quella stringa, perché pretende che un messaggio
 *      cominci per lettera (`/^[a-zA-ZÀ-ſ]/`) e quella comincia per parentesi
 *      quadra, e restituisce il generico «Qualcosa non ha funzionato.»
 *
 * Il cliente riprovava all'infinito una cosa che non poteva riuscire. E chi aveva
 * pagato in contanti non veniva MAI mandato all'assistenza, che era l'unica strada
 * per riavere i soldi.
 *
 * Queste prove percorrono la catena vera — corpo del server → messaggio letto →
 * testo mostrato — invece di controllare che nel sorgente ci sia scritta la parola
 * giusta.
 */

const RADICE = resolve(__dirname, '..', '..');
const leggi = (f: string) => readFileSync(resolve(RADICE, f), 'utf8');

/** Il corpo VERO che il server manda, preso da ApiErrors invece che riscritto a mano. */
async function corpoDelServer(messaggio: string): Promise<unknown> {
  return ApiErrors.conflict(messaggio).json();
}

const RIFIUTI = [
  'Il negozio ha già accettato l ordine, non puoi più annullarlo.',
  'Ordine già incassato in contanti: scrivi all assistenza per la restituzione.',
  'Ordine già annullato',
];

describe('il motivo scritto dal server arriva fino agli occhi del cliente', () => {
  for (const motivo of RIFIUTI) {
    it(`«${motivo.slice(0, 46)}…» non diventa un messaggio generico`, async () => {
      const corpo = await corpoDelServer(motivo);

      // ② come lo legge il client, dopo il fix
      const letto = apiErrorMessage(corpo, 'Impossibile annullare');
      expect(letto).toBe(motivo);

      // ③ e come finisce a video
      const mostrato = friendlyError(new Error(letto));
      expect(mostrato).toContain(motivo.slice(0, 24));
      expect(mostrato).not.toMatch(/Qualcosa non ha funzionato/);
      expect(mostrato).not.toContain('[object Object]');
    });
  }

  it('IL DIFETTO, RICREATO: leggendo `error` come stringa si perde tutto', async () => {
    const corpo = (await corpoDelServer(RIFIUTI[1])) as { error?: unknown };
    // Esattamente la riga di prima: l'oggetto è truthy e finisce dentro new Error().
    const comePrima = new Error((corpo.error as string) || 'Impossibile annullare');
    expect(comePrima.message).toBe('[object Object]');
    // E friendlyError la butta, perché non comincia per lettera.
    expect(friendlyError(comePrima)).toMatch(/Qualcosa non ha funzionato/);
  });

  it('se il corpo non ha un motivo, il ripiego resta quello dichiarato', () => {
    expect(apiErrorMessage({}, 'Impossibile annullare')).toBe('Impossibile annullare');
    expect(apiErrorMessage(null, 'Impossibile annullare')).toBe('Impossibile annullare');
    expect(apiErrorMessage({ error: '   ' }, 'Impossibile annullare')).toBe('Impossibile annullare');
  });
});

describe('nessuno legge piu` `error` come se fosse una stringa', () => {
  // Il perimetro sono i due punti che la radiografia ha trovato rotti. Gli altri
  // chiamanti leggevano gia' `.error?.message` per primo, quindi funzionavano.
  const PUNTI = ['app/orders/[id]/page.tsx', 'components/seller/ReturnRequestCard.tsx'];

  for (const f of PUNTI) {
    it(`${f} passa dalla porta condivisa`, () => {
      const src = leggi(f);
      expect(src).toContain('apiErrorMessage(');
      // Le due forme rotte, ognuna col suo caso vero.
      expect(src).not.toMatch(/new Error\(\s*corpo\.error\s*\|\|/);
      expect(src).not.toMatch(/new Error\(\s*j\.error\s*\?\?\s*j\.message/);
    });
  }
});
