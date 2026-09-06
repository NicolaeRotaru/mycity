/**
 * 6/9/2026 — L'AVVISO CHE DICEVA SOLTANTO «ERRORE».
 *
 * Cinque punti del sito chiudevano il loro `catch` così:
 *
 *     toast.error(e instanceof Error ? e.message : 'Errore')
 *
 * Quando quello che viene lanciato non è un Error — un reject nudo, una stringa,
 * un oggetto qualunque — al cliente restava la parola secca «Errore». Non dice
 * cosa è successo, non dice cosa fare, e chi la legge può solo ripremere a caso.
 * Nei punti dove capita — il reso di un ordine, l'incasso in contanti del
 * fattorino, l'iscrizione del fattorino, le notifiche — ripremere a caso è
 * esattamente ciò che non deve succedere.
 *
 * Lo stesso valeva per il ripiego passato a `apiErrorMessage(data, 'Errore')`:
 * quando la risposta del server non porta un messaggio, la parola che arrivava
 * a video era «Errore».
 *
 * LA CURA. La frase buona esisteva già in lib/errors.ts — «Qualcosa non ha
 * funzionato. Riprova fra un momento.» — e `friendlyError` la usa solo quando
 * non ha di meglio: se il server ha mandato un motivo leggibile, tiene quello.
 *
 * ⚪ COSA NON COPRE. Legge i sorgenti veri, non monta i componenti: in questa
 * repo un .tsx non si può importare in una prova. Prova che la stringa nuda non
 * c'è più e che la funzione giusta è importata dove viene usata; non prova i
 * pixel del riquadro che compare.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { friendlyError } from '@/lib/errors';

/** I punti che questa squadra possiede. */
const PUNTI = [
  'components/ProductCard.tsx',
  'app/orders/[id]/return/page.tsx',
  'components/PushNotificationOptIn.tsx',
  'components/rider/CashConfirmDialog.tsx',
  'app/rider/onboarding/page.tsx',
];

describe('quello che legge chi trova un guasto', () => {
  it.each(PUNTI)('in %s non è rimasta la parola secca «Errore»', (file) => {
    const sorgente = readFileSync(file, 'utf8');
    expect(sorgente).not.toContain("'Errore'");
    expect(sorgente).not.toContain('"Errore"');
  });

  it.each(PUNTI)('%s dice qualcosa di utile, non ripiega su una parola', (file) => {
    const sorgente = readFileSync(file, 'utf8');
    // O passa da friendlyError, o scrive lui una frase intera (ProductCard).
    const parla =
      /friendlyError\(/.test(sorgente) ||
      /toast\.error\('[^']{25,}'\)/.test(sorgente);
    expect(parla).toBe(true);
    if (/friendlyError\(/.test(sorgente)) {
      expect(sorgente).toMatch(/import \{[^}]*friendlyError[^}]*\} from '@\/lib\/errors'/);
    }
  });
});

describe('la frase che arriva quando non si sa altro', () => {
  it('è una frase intera in italiano, non la parola «Errore»', () => {
    // Il caso vero del difetto: qualcosa che non è un Error.
    for (const buttato of [undefined, null, {}, Symbol('boh')]) {
      const detto = friendlyError(buttato);
      expect(detto).not.toBe('Errore');
      expect(detto.split(' ').length).toBeGreaterThan(3);
    }
  });

  it('quando il server un motivo ce l\'ha, quello si tiene', () => {
    expect(friendlyError(new Error('Il rider ha già confermato questo incasso')))
      .toContain('già confermato');
  });
});
