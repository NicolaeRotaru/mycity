/**
 * PERCHE' QUESTA PROVA ESISTE.
 *
 * Il 3/9/2026 abbiamo chiuso un difetto vero: una risposta del modello fermata dal tetto dei token
 * passava per completa, e su un blocco strutturato scriveva dati storti sui prodotti. Il fix la
 * trasforma in errore per tutti e ventuno i punti che chiamano il modello.
 *
 * La revisione ha trovato il rovescio: la descrizione del prodotto ha un tetto di 300 token, quindi
 * li' il taglio e' la normalita'. Con il fix cosi' com'era, al negoziante che carica la merce non
 * usciva piu' niente — e quello e' il flusso che stiamo per portare live.
 *
 * Questa prova pinna la scelta: la descrizione accetta il taglio e si chiude all'ultima frase
 * intera; il resto delle chiamate no.
 *
 * NON-VACUITA' (eseguita il 3/9/2026): togliendo `seTagliata: 'accetta'` dalla rotta, il caso
 * «tagliata» diventa rosso con «expected 500 to be 200». Togliendo il taglio alla frase, resta rosso
 * il caso della riga mozza.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Il codice senza i commenti.
 *
 * Serve perche' la prima stesura di questa prova era VERDE PER FINTA: togliendo la riga vera dalla
 * chiamata, la stessa frase restava scritta nel commento sopra e la ricerca la trovava lo stesso.
 * E' la trappola che oggi ha gia' fregato due squadre, una volta dentro una riga di import.
 */
function rotteSotto(radice: string): string[] {
  const fuori: string[] = [];
  for (const voce of readdirSync(radice, { withFileTypes: true })) {
    const p = join(radice, voce.name);
    if (voce.isDirectory()) fuori.push(...rotteSotto(p));
    else if (voce.name === 'route.ts') fuori.push(p);
  }
  return fuori;
}

function senzaCommenti(percorso: string): string {
  return readFileSync(percorso, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
import { tagliaAllUltimaFraseIntera } from '@/lib/ai/taglia-alla-frase';

describe('una descrizione tagliata esce corta, non a meta parola', () => {
  it('chiude il testo all ultima frase intera', () => {
    const mozzo = 'Pane di grano duro, lievitato 24 ore. Crosta spessa e mollica alveolata. Perfetto per la col';
    expect(tagliaAllUltimaFraseIntera(mozzo)).toBe(
      'Pane di grano duro, lievitato 24 ore. Crosta spessa e mollica alveolata.',
    );
  });

  it('tiene la punteggiatura che chiude la frase, virgolette comprese', () => {
    expect(tagliaAllUltimaFraseIntera('Lo chiamano "il pane della domenica." E poi si fer')).toBe(
      'Lo chiamano "il pane della domenica."',
    );
    expect(tagliaAllUltimaFraseIntera('Ti piacera? Davvero. Ma sen')).toBe('Ti piacera? Davvero.');
  });

  it('se non c e nemmeno una frase intera non mostra niente', () => {
    // Meglio nessuna descrizione che una riga mozza sotto la foto del pane.
    expect(tagliaAllUltimaFraseIntera('Pane di grano duro lievitato ventiquattro or')).toBe('');
    expect(tagliaAllUltimaFraseIntera('   ')).toBe('');
  });

  it('un testo gia completo non viene toccato', () => {
    const intero = 'Pane di grano duro, lievitato 24 ore.';
    expect(tagliaAllUltimaFraseIntera(intero)).toBe(intero);
  });

  it('la rotta della descrizione dichiara di accettare il taglio, e chiude la frase', () => {
    // La rotta non si importa in vitest (usa next/server): qui verifico l invariante di struttura,
    // cioe che la scelta sia scritta dove il modello viene chiamato e che il taglio passi dalla
    // funzione che chiude la frase.
    const src = senzaCommenti('app/api/ai/description/route.ts');
    expect(src).toMatch(/seTagliata:\s*'accetta'/);
    expect(src).toMatch(/tagliaAllUltimaFraseIntera\(/);
  });

  it('nessun altro punto che chiama il modello accetta il taglio di nascosto', () => {
    // Il difetto originale era proprio questo: il taglio passava per completo. Se domani qualcuno
    // aggiunge `seTagliata: 'accetta'` altrove, questa prova lo fa vedere.
    // `lib/ai/run.ts` e' la casa dell'opzione, non un chiamante: la nomina per definirla.
    const file = [...rotteSotto('app/api'), ...readdirSync('lib/ai').filter((f) => f.endsWith('.ts')).map((f) => join('lib/ai', f))].filter(
      (f) => f !== 'lib/ai/run.ts',
    );
    const conIlPermesso = file.filter((f) => /seTagliata:\s*'accetta'/.test(senzaCommenti(f)));
    expect(conIlPermesso.sort()).toEqual(['app/api/ai/description/route.ts']);
  });
});
