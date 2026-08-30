/**
 * 27/8/2026 (R075) — QUATTRO RICHIESTE AL MINUTO PER DUE PALLINI.
 *
 * Il cruscotto del venditore teneva due conteggi vivi — gli ordini da fare e le notifiche non
 * lette — e ognuno dei due, a ogni giro, cominciava con `supabase.auth.getUser()`. Quella non è una
 * lettura dalla memoria: è una chiamata di rete al servizio di autenticazione. Due sondaggi più due
 * domande su chi sei, ogni minuto, per ogni scheda del pannello aperta — anche mentre la scheda sta
 * in secondo piano e nessuno la guarda.
 *
 * Chi sei lo sa già la pagina: `useProfile()` lo chiede una volta sola e lo condivide con tutti.
 *
 * Oggi il costo in valore assoluto è trascurabile (un negozio attivo). Cresce però su «negozi × ore
 * aperte», che è la peggiore delle basi di calcolo: non con gli ordini, ma con le schede aperte.
 *
 * Prova di STRUTTURA, dichiarata: in questa repo un componente React non si monta dentro una prova
 * (`jsx: preserve` nel tsconfig, e la configurazione di vitest è di un altro lotto).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('components/seller/SellerShell.tsx', 'utf8');

describe('i due conteggi del cruscotto venditore', () => {
  it('non chiedono al servizio di autenticazione chi sei', () => {
    expect(src, 'una chiamata di rete all\'autenticazione dentro ogni giro di sondaggio').not.toContain('auth.getUser()');
    expect(src, 'l\'identità deve arrivare dal profilo già condiviso').toContain('useProfile()');
  });

  it('non girano mentre la scheda sta in secondo piano', () => {
    const sondaggi = [...src.matchAll(/refetchInterval:\s*([\d_]+)/g)].map((m) => Number(m[1].replace(/_/g, '')));
    expect(sondaggi.length, 'i sondaggi sono spariti: questa prova non misura più niente').toBeGreaterThan(0);
    for (const ms of sondaggi) {
      expect(ms, 'un sondaggio più fitto di un minuto su una pagina che resta aperta tutto il giorno')
        .toBeGreaterThanOrEqual(60_000);
    }
    const inSecondoPiano = src.match(/refetchIntervalInBackground:\s*false/g) ?? [];
    expect(inSecondoPiano.length, 'ogni sondaggio deve fermarsi quando la scheda non è in primo piano')
      .toBe(sondaggi.length);
  });
});
