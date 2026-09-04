import { describe, it, expect } from 'vitest';
import { safeInternalPath } from '@/lib/safe-redirect';

/**
 * IL RITORNO DOPO L'ACCESSO RESTA IN CASA NOSTRA.
 *
 * 3/9/2026 — UN CARATTERE INVISIBILE PORTAVA IL CLIENTE SU UN SITO ESTERNO
 * DOPO CHE AVEVA MESSO LA PASSWORD.
 *
 * La funzione che ripulisce il percorso di ritorno bloccava gli indirizzi
 * assoluti, il doppio slash e la barra rovesciata, ma NON la tabulazione, il
 * ritorno a capo e l'a capo. Il lettore di indirizzi dei browser e di Node
 * cancella quei tre caratteri prima di interpretare: cosi' `/<TAB>/sito-truffa.it`
 * usciva dal filtro intatto e, appena risolto contro il nostro dominio in
 * app/auth/callback/route.ts, diventava `https://sito-truffa.it`.
 *
 * Il link parte dal dominio vero. La signora Rossi lo apre da WhatsApp, vede il
 * nostro indirizzo nella barra, mette email e password sul NOSTRO modulo, e
 * subito dopo si ritrova su una copia del sito che le richiede la password o la
 * carta «per confermare». Vale per i clienti e vale per i negozianti, che
 * sull'account hanno il conto dove arrivano i soldi.
 *
 * COSA CONTROLLA. Non si accontenta di guardare la stringa: fa quello che fa il
 * sito — risolve il percorso ripulito contro il nostro dominio — e pretende che
 * la casa non cambi. E' il controllo che il filtro non faceva, ed e' il motivo
 * per cui la barra rovesciata era stata tappata e questi tre no.
 */

const NOSTRO = 'https://mycity-marketplace.com';

/** Quello che fa il sito: risolve il percorso contro il nostro dominio. */
function doveFinisce(percorsoChiesto: unknown): string {
  return new URL(safeInternalPath(percorsoChiesto, '/'), NOSTRO).hostname;
}

describe('i caratteri che il lettore di indirizzi cancella', () => {
  // Sono i tre che la funzione lasciava passare, piu' le combinazioni con cui
  // arrivano davvero in un indirizzo.
  const trucchi: Array<[string, string]> = [
    ['tabulazione', '/\t/sito-truffa.example.com'],
    ['a capo', '/\n/sito-truffa.example.com'],
    ['ritorno a capo', '/\r/sito-truffa.example.com'],
    ['tabulazione dentro il doppio slash', '/\t\t/sito-truffa.example.com'],
    ['ritorno a capo fra le due barre', '/\r\n/sito-truffa.example.com'],
    ['tabulazione prima della barra rovesciata', '/\t\\sito-truffa.example.com'],
    ['tabulazione dentro lo schema', 'ht\ttps://sito-truffa.example.com'],
  ];

  for (const [nome, trucco] of trucchi) {
    it(`IL CASO CHE ROMPEVA — ${nome}: il cliente non esce da casa nostra`, () => {
      expect(doveFinisce(trucco), 'il cliente e finito su un sito esterno col nostro dominio nella barra').toBe(
        'mycity-marketplace.com',
      );
    });
  }

  it('il percorso che esce dal filtro non porta piu i caratteri invisibili', () => {
    // Se uscissero, il lettore di indirizzi li toglierebbe DOPO — cioe' fuori
    // dal controllo — ed e' esattamente cosi' che nasceva il buco.
    expect(safeInternalPath('/\t/sito-truffa.example.com')).not.toMatch(/[\t\n\r]/);
  });
});

describe('i trucchi gia conosciuti restano chiusi', () => {
  it('indirizzo assoluto', () => {
    expect(doveFinisce('https://sito-truffa.example.com/pagina')).toBe('mycity-marketplace.com');
  });

  it('doppio slash', () => {
    expect(doveFinisce('//sito-truffa.example.com')).toBe('mycity-marketplace.com');
  });

  it('barra rovesciata', () => {
    expect(doveFinisce('/\\sito-truffa.example.com')).toBe('mycity-marketplace.com');
  });

  it('la casa non cambia nemmeno cambiando le credenziali dentro l indirizzo', () => {
    expect(doveFinisce('/\t//utente:password@sito-truffa.example.com')).toBe('mycity-marketplace.com');
  });
});

describe('quello che non si deve rompere', () => {
  it('i percorsi veri del sito tornano identici', () => {
    expect(safeInternalPath('/')).toBe('/');
    expect(safeInternalPath('/profile/settings')).toBe('/profile/settings');
    expect(safeInternalPath('/search?q=pizza&cat=food')).toBe('/search?q=pizza&cat=food');
    expect(safeInternalPath('/orders#delivered')).toBe('/orders#delivered');
    expect(safeInternalPath('/cerca/pizza%20margherita')).toBe('/cerca/pizza%20margherita');
  });

  it('un percorso vero porta davvero dove deve', () => {
    expect(new URL(safeInternalPath('/orders/123'), NOSTRO).href).toBe('https://mycity-marketplace.com/orders/123');
  });
});
