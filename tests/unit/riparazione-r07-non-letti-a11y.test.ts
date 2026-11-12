import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R07-007 (12/11/2026) — chi usa il lettore di schermo sentiva «3» accanto a una
 * conversazione, senza sapere che erano messaggi da leggere; e il pallino delle
 * notifiche aveva un aria-label su uno <span> senza ruolo, che i lettori ignorano.
 * Prova leggera sul testo della pagina: il numero è muto e accanto c'è la frase.
 */
const messaggi = readFileSync('app/messages/page.tsx', 'utf8');
const notifiche = readFileSync('app/notifications/page.tsx', 'utf8');

describe('R07-007 · i non letti si dicono a parole', () => {
  it('chat: il numero è aria-hidden e la frase «messaggi non letti» sta in sr-only', () => {
    const i = messaggi.indexOf('{unread > 0 && (');
    expect(i).toBeGreaterThan(-1);
    const pallino = messaggi.slice(i, messaggi.indexOf('</Link>', i));
    expect(pallino).toMatch(/<span aria-hidden="true">\{unread > 99 \? '99\+' : unread\}<\/span>/);
    expect(pallino).toMatch(/<span className="sr-only">.*messaggi non letti/);
  });

  it('notifiche: il pallino è aria-hidden e «Non letta» sta in sr-only, non in un aria-label senza ruolo', () => {
    const i = notifiche.indexOf('{!n.is_read && (');
    expect(i).toBeGreaterThan(-1);
    const pallino = notifiche.slice(i, i + 600);
    expect(pallino).not.toMatch(/aria-label="Non letta"/);
    expect(pallino).toMatch(/bg-primary-600" aria-hidden="true"/);
    expect(pallino).toMatch(/<span className="sr-only">Non letta<\/span>/);
  });
});
