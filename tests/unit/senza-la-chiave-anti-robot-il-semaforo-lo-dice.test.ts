/**
 * PERCHE' ESISTE QUESTA PROVA.
 *
 * Dal 3/9/2026 il controllo anti-robot, se la sua chiave manca, rifiuta la richiesta invece di
 * lasciar passare tutti. E' la scelta giusta — una difesa spenta che si comporta come una accesa e'
 * peggio di nessuna difesa — ma ha un rovescio pesante: senza quella chiave, in produzione, si
 * spengono insieme accesso, registrazione, contatti e newsletter. Cioe' la porta d'ingresso.
 *
 * La revisione del lotto l'ha chiamata «una verifica di trenta secondi da fare prima di unire».
 * Trenta secondi che qualcuno puo' dimenticare. Questa prova pinna il fatto che, se succede, a
 * dirlo e' il semaforo della salute — e non il primo cliente che non riesce a entrare.
 *
 * NON-VACUITA' (eseguita): togliendo 'TURNSTILE_SECRET_KEY' da ENV_VITALI in
 * app/api/health/route.ts, questa prova diventa rossa.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('senza la chiave anti-robot il semaforo lo dice', () => {
  it('la chiave del controllo anti-robot sta fra le variabili che il semaforo dichiara', () => {
    // Non fra quelle che valgono un 503: senza quella chiave il sito RISPONDE, e spegnerlo
    // sarebbe una bugia al contrario. Sta fra quelle che dicono «manca un pezzo», che e' il vero.
    const src = readFileSync('app/api/health/route.ts', 'utf8');
    const vitali = src.slice(src.indexOf('const ENV_VITALI'), src.indexOf('];', src.indexOf('const ENV_VITALI')));
    const importanti = src.slice(src.indexOf('const ENV_IMPORTANTI'), src.indexOf('];', src.indexOf('const ENV_IMPORTANTI')));
    expect(importanti).toContain('TURNSTILE_SECRET_KEY');
    expect(vitali).not.toContain('TURNSTILE_SECRET_KEY');
  });

  it('il controllo anti-robot rifiuta quando la chiave manca, invece di lasciar passare', () => {
    const src = readFileSync('lib/captcha.ts', 'utf8');
    // In produzione senza chiave: si rifiuta e si registra l'errore. Fuori produzione si salta,
    // dichiarandolo con `skipped`.
    expect(src).toMatch(/NODE_ENV === 'production'[\s\S]{0,400}ok: false/);
    expect(src).toMatch(/skipped: true/);
  });
});
