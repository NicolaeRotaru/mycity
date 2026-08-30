/**
 * 27/8/2026 (R089) — LA RICERCA DICEVA «NESSUN RISULTATO» QUANDO ERA SEMPLICEMENTE ROTTA.
 *
 * Il riquadro sotto la barra di ricerca conosceva due stati: «sto caricando» e «non c'è niente».
 * Se la lettura falliva — rete storta, funzione di ricerca non applicata, tempo scaduto — l'elenco
 * restava vuoto, il caricamento era finito, e al cliente compariva a schermo «Nessun risultato per
 * «pane»». Lo screen reader lo diceva pure ad alta voce: «Nessun suggerimento per pane».
 *
 * È un'affermazione falsa sul mondo detta nel momento in cui uno ha deciso di comprare. Nessuno
 * riprova una ricerca che gli ha appena risposto «non c'è»: se ne va, e il negozio perde una
 * vendita su merce che aveva in negozio. La barra sta su ogni pagina, quindi valeva per tutti.
 *
 * Gli stati sono TRE, non due (è la regola di `lib/stato-vista.ts`): carico · rotto · vuoto. «Vuoto»
 * è una cosa che si può dire solo dopo aver guardato davvero.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { riquadroSuggerimenti } from '@/lib/ricerca/riquadro-suggerimenti';

describe('il riquadro dei suggerimenti', () => {
  it('su una lettura fallita non dice che il prodotto non esiste', () => {
    const v = riquadroSuggerimenti({ termine: 'pane', caricando: false, errore: new Error('rete giù'), quanti: 0 });
    expect(v.mostra, 'al cliente veniva detto che il prodotto non c\'è, e se ne andava').toBe('errore');
  });

  it('e non lo annuncia nemmeno a chi naviga a voce', () => {
    const v = riquadroSuggerimenti({ termine: 'pane', caricando: false, errore: new Error('rete giù'), quanti: 0 });
    expect(v.annuncio).not.toContain('Nessun');
  });

  it('mentre i suggerimenti arrivano non si dichiara niente', () => {
    const v = riquadroSuggerimenti({ termine: 'pane', caricando: true, quanti: 0 });
    expect(v.mostra).toBe('attesa');
    expect(v.annuncio, 'lo screen reader diceva «Nessun suggerimento» e un istante dopo «sei»').toBe('');
  });

  it('dopo aver guardato davvero, il vuoto si può dire', () => {
    const v = riquadroSuggerimenti({ termine: 'ghiaccio secco', caricando: false, quanti: 0 });
    expect(v.mostra).toBe('vuoto');
    expect(v.annuncio).toBe('Nessun suggerimento per ghiaccio secco');
  });

  it('con i risultati in mano li mostra, e li conta al singolare quando è uno solo', () => {
    expect(riquadroSuggerimenti({ termine: 'pane', caricando: false, quanti: 1 })).toEqual({
      mostra: 'elenco',
      annuncio: '1 suggerimento disponibile',
    });
    expect(riquadroSuggerimenti({ termine: 'pane', caricando: false, quanti: 6 }).annuncio).toBe('6 suggerimenti disponibili');
  });

  it('se qualcosa è già a schermo, un errore non lo fa sparire', () => {
    // Un errore su una nuova battuta di tasti non deve svuotare quello che la persona sta leggendo.
    const v = riquadroSuggerimenti({ termine: 'pane', caricando: false, errore: new Error('boom'), quanti: 3 });
    expect(v.mostra).toBe('elenco');
  });
});

describe('la barra di ricerca usa quel verdetto e non se ne fa uno suo', () => {
  // Controllo di STRUTTURA, dichiarato per quello che è: in questa repo un componente React non si
  // può montare in una prova (il tsconfig tiene `jsx: preserve` e la configurazione di vitest, che
  // è di un altro lotto, non ha il plugin react). Questa riga muore il giorno in cui qualcuno
  // rimette nel componente un ramo «vuoto» che non passa dal verdetto qui sopra.
  const src = readFileSync('components/SearchBar.tsx', 'utf8');

  it('il verdetto viene calcolato prima di qualunque frase sul vuoto', () => {
    const verdetto = src.indexOf('riquadroSuggerimenti(');
    expect(verdetto, 'la barra di ricerca decide ancora da sola cosa dire').toBeGreaterThan(0);
    for (const frase of ['Nessun risultato per', 'annuncio']) {
      expect(src.indexOf(frase), `«${frase}» compare prima del verdetto`).toBeGreaterThan(verdetto);
    }
  });

  it('la frase sul vuoto compare una volta sola, e il conteggio non è più scritto a mano nel componente', () => {
    expect(src.split('Nessun risultato per').length - 1).toBe(1);
    expect(src, 'l\'annuncio a voce è tornato a essere scritto nel componente').not.toContain('Nessun suggerimento per');
  });
});
