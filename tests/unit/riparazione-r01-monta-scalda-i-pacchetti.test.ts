/**
 * 17/11/2026 — L'AIUTANTE CHE MONTA I COMPONENTI SCALDA I PACCHETTI QUANDO SI CARICA.
 *
 * Il primo caso di ogni file che usa `monta()` pagava, dentro il suo tempo, anche il primo import
 * di react, react-dom, delle icone e di react-query: misurato, mediana 257 ms contro 14 ms di un
 * caso qualunque, fino a 1,1 s sotto carico. Il tempo massimo di un caso è già 15 s
 * (vitest.config.ts); qui si sposta anche il costo dei pacchetti nella raccolta del file, che non
 * conta nel tempo del caso: caricare l'aiutante li deve aver già importati.
 */
import { describe, it, expect, vi } from 'vitest';

const PACCHETTI = ['react', 'react-dom/client', 'react-dom/server', 'lucide-react', '@tanstack/react-query'];

describe('monta-componente scalda i pacchetti condivisi', () => {
  it('caricare l\'aiutante importa già react, react-dom, le icone e react-query', async () => {
    const caricati: string[] = [];
    for (const p of PACCHETTI) {
      vi.doMock(p, async (originale: () => Promise<unknown>) => {
        caricati.push(p);
        return originale();
      });
    }
    try {
      await import('./aiuti/monta-componente');
    } finally {
      for (const p of PACCHETTI) vi.doUnmock(p);
    }
    expect([...caricati].sort(), 'il primo caso pagherebbe questi import dentro il suo tempo').toEqual([...PACCHETTI].sort());
  });
});
