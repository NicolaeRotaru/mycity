import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import { ApiErrors } from '@/lib/api/responses';

/**
 * IL TESTO DICE QUELLO CHE SUCCEDE DAVVERO (radiografia del design, 22/8/2026).
 *
 * Due schermate promettevano cose che il codice sotto non faceva.
 *
 * ① IL SOS DEL FATTORINO. `window.location.href = 'tel:112'` apre il compositore
 *    del telefono col numero già scritto: la chiamata parte SOLO se il fattorino
 *    preme il tasto verde. I due messaggi dicevano «Stiamo chiamando il 112» e
 *    «Chiamata al 112 in corso», tutti e due al presente, come se stesse già
 *    squillando. Un fattorino che ha appena premuto SOS poteva restare ad
 *    aspettare una chiamata che nessuno aveva fatto partire — nel momento in cui
 *    conta di più. Il ramo peggiore era il secondo: lì l'avviso a MyCity NON era
 *    partito, e il messaggio era il più rassicurante dei due.
 *
 * ② LA CHAT DELL'ASSISTENZA. Chi scriveva all'assistenza poteva vedersi
 *    rispondere «[object Object]»: stesso difetto già visto sull'annullamento
 *    ordine, e qui per di più senza passare da `friendlyError`.
 */

const RADICE = resolve(__dirname, '..', '..');
const leggi = (f: string) => readFileSync(resolve(RADICE, f), 'utf8');

describe('① il SOS non promette una chiamata che nessuno ha fatto partire', () => {
  const sos = leggi('components/rider/SOSButton.tsx');

  /**
   * I messaggi VERI, non il file intero.
   *
   * La prima stesura cercava le frasi vecchie in tutto il sorgente, e diventava rossa sul
   * commento che spiega perché erano sbagliate — cioè puniva la spiegazione insieme al
   * difetto. È «menzione ≠ dichiarazione», la stessa forma già vista altrove: quello che
   * conta è cosa finisce dentro `toast`, non cosa si legge intorno.
   */
  const messaggiToast = [...sos.matchAll(/toast\.(?:success|error)\('([^']+)'/g)].map((m) => m[1]);

  it('apre il tastierino, quindi NON dice di stare chiamando', () => {
    expect(sos).toContain("window.location.href = 'tel:112'");
    expect(messaggiToast.length).toBeGreaterThanOrEqual(2);
    for (const t of messaggiToast) {
      expect(t).not.toMatch(/stiamo chiamando/i);
      expect(t).not.toMatch(/chiamata al 112 in corso/i);
    }
  });

  it('tutti e due i messaggi dicono al fattorino di premere CHIAMA', () => {
    // Il ramo buono e il ramo di ripiego: in tutti e due il tastierino è aperto
    // e la chiamata dipende da un gesto suo.
    const sulSos = messaggiToast.filter((t) => /112/.test(t));
    expect(sulSos.length).toBe(2);
    for (const t of sulSos) expect(t).toMatch(/premi\s+(subito\s+)?CHIAMA/i);
  });

  it('quando l’avviso a MyCity NON parte, il messaggio lo dice', () => {
    // È il ramo in cui prima si leggeva la frase più rassicurante delle due.
    expect(messaggiToast.some((t) => /NON è stata avvisata/.test(t))).toBe(true);
  });

  it('il dialogo di conferma resta al futuro, com’era giusto', () => {
    // Era già scritto bene venti righe più in basso: il testo esatto stava lì.
    expect(sos).toContain('Verrà avviata la chiamata al');
  });
});

describe('② chi scrive all’assistenza legge parole, non «[object Object]»', () => {
  const chat = leggi('components/SupportChatModal.tsx');

  it('il modale passa dalla porta condivisa, e mostra con friendlyError', () => {
    expect(chat).toContain('apiErrorMessage(j,');
    expect(chat).toContain('friendlyError(e)');
    expect(chat).not.toMatch(/new Error\(\s*j\.error\s*\?\?\s*j\.message/);
    expect(chat).not.toContain("e instanceof Error ? e.message : 'Errore'");
  });

  it('il motivo vero della rotta arriva a video', async () => {
    // Il caso che capita davvero: il limite di richieste.
    const corpo = await ApiErrors.rateLimited(30, 'Troppe richieste. Riprova tra 30s.').json();
    const letto = apiErrorMessage(corpo, 'Impossibile aprire la chat');
    expect(letto).toBe('Troppe richieste. Riprova tra 30s.');
    expect(friendlyError(new Error(letto))).not.toContain('[object Object]');
  });

  it('IL DIFETTO, RICREATO: leggendo `error` come stringa esce «[object Object]»', async () => {
    const corpo = (await ApiErrors.internal('Errore interno').json()) as { error?: unknown };
    expect(new Error((corpo.error as string) ?? 'x').message).toBe('[object Object]');
  });
});
