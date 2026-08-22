import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 22/8/2026 — IL FRENO, NON LA TOPPA.
 *
 * Il tetto sul corpo delle richieste esisteva dal 20 agosto — un lettore che
 * legge a pezzi e si ferma davvero appena si sfora, invece di credere
 * all'intestazione `content-length` che manda chi chiama. Poi cinquantatre
 * rotte continuavano a chiamare `req.json()` nudo, che carica tutto in memoria
 * PRIMA di guardare quanto e' grande. Fra quelle: la cassa in contanti, il
 * checkout con carta, le rotte che ricevono foto.
 *
 * Un solo utente, con una richiesta da qualche centinaio di megabyte, faceva
 * cadere l'istanza — e con lei il sito per tutti.
 *
 * Sistemarle una per una non basta: la cinquantaquattresima nasce nuda come le
 * altre, perche' `req.json()` e' quello che si scrive per abitudine. Questo
 * controllo legge i file e diventa rosso il giorno in cui ne entra una.
 */

function fileSotto(cartella: string): string[] {
  const trovati: string[] = [];
  for (const voce of readdirSync(cartella)) {
    const percorso = join(cartella, voce);
    if (statSync(percorso).isDirectory()) trovati.push(...fileSotto(percorso));
    else if (voce.endsWith('.ts') || voce.endsWith('.tsx')) trovati.push(percorso);
  }
  return trovati;
}

describe('nessun corpo di richiesta senza tetto', () => {
  it('nessuna rotta sotto app/api legge il corpo con req.json() nudo', () => {
    const nude: string[] = [];
    for (const f of fileSotto('app/api')) {
      const testo = readFileSync(f, 'utf8');
      if (/await\s+(req|request)\s*\.\s*json\s*\(\s*\)/.test(testo)) nude.push(f);
    }
    expect(nude, `queste rotte caricano il corpo senza tetto:\n  ${nude.join('\n  ')}`).toEqual([]);
  });

  it('il tetto si ferma davvero, non si fida di quello che dichiara chi chiama', async () => {
    const { jsonRichiesta, CorpoTroppoGrande } = await import('@/lib/api/corpo');
    const grosso = JSON.stringify({ foto: 'x'.repeat(5000) });
    const req = new Request('http://localhost/prova', {
      method: 'POST',
      // Dichiara 10 byte: se il controllo si fidasse di questa riga, passerebbe.
      headers: { 'content-type': 'application/json', 'content-length': '10' },
      body: grosso,
    });
    await expect(jsonRichiesta(req, 1000)).rejects.toBeInstanceOf(CorpoTroppoGrande);
  });

  it('un corpo dentro il tetto passa come prima', async () => {
    const { jsonRichiesta } = await import('@/lib/api/corpo');
    const req = new Request('http://localhost/prova', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ciao: 'mondo' }),
    });
    await expect(jsonRichiesta(req, 1_000_000)).resolves.toEqual({ ciao: 'mondo' });
  });
});
