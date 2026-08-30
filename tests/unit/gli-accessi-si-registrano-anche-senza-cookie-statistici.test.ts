/**
 * 27/8/2026 (R064) — IL REGISTRO DEGLI ACCESSI ERA VUOTO PROPRIO PER CHI RIFIUTA I COOKIE.
 *
 * L'informativa dichiara un trattamento di sicurezza e anti-frode su base di legittimo interesse:
 * teniamo traccia degli accessi. Il server lo fa bene — `app/api/track/route.ts` chiede il consenso
 * statistico solo agli eventi di categoria «visitatore» (la pagina vista) e lascia passare accesso
 * e disconnessione — e senza consenso non deposita nemmeno il cookie che segue la persona.
 *
 * Solo che dal browser quegli eventi non partivano affatto: il cancello del consenso stava sulla
 * prima riga di `send()`, prima di qualunque distinzione, e accesso e disconnessione passano di lì.
 *
 * Due danni opposti nello stesso difetto: dichiariamo un trattamento che per una parte delle
 * persone non avviene (informativa inesatta), e il giorno che a qualcuno rubano l'account non
 * abbiamo la traccia degli accessi proprio per chi è più attento alla propria privacy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { serveIlConsensoStatistico } from '@/lib/analytics/tracciamento';

describe('quali eventi chiedono il permesso', () => {
  it('la pagina vista sì: è sorveglianza del visitatore', () => {
    expect(serveIlConsensoStatistico('page_view')).toBe(true);
  });

  it('accesso e disconnessione no: sono sicurezza, e valgono per tutti', () => {
    expect(serveIlConsensoStatistico('login'), 'nessuna traccia dell\'accesso a chi rifiuta i cookie').toBe(false);
    expect(serveIlConsensoStatistico('logout')).toBe(false);
  });

  it('la regola qui è la stessa che applica il server, riga per riga', () => {
    // Se un giorno il server cambia categoria a un evento e qui no, il browser torna a tacere (o a
    // parlare troppo) senza che nessuno se ne accorga: questa riga tiene le due tabelle allineate.
    const rotta = readFileSync('app/api/track/route.ts', 'utf8');
    const mappa = rotta.slice(rotta.indexOf('const ALLOWED_EVENTS'), rotta.indexOf('const SUMMARY'));
    for (const evento of ['page_view', 'login', 'logout'] as const) {
      const categoria = new RegExp(`${evento}:\\s*'(\\w+)'`).exec(mappa)?.[1];
      expect(categoria, `il server non conosce più l'evento ${evento}`).toBeTruthy();
      expect(serveIlConsensoStatistico(evento)).toBe(categoria === 'visitor');
    }
  });
});

describe('il beacon del browser', () => {
  const src = readFileSync('components/ActivityTracker.tsx', 'utf8');

  it('non spegne tutto in blocco al primo controllo', () => {
    // Controllo di struttura (in questa repo i componenti React non si montano dentro una prova):
    // il cancello non deve più stare prima della distinzione fra i tipi di evento.
    expect(src, 'il cancello è tornato a valere per qualunque evento').not.toContain("if (!hasConsent('analytics')) return;");
    expect(src).toContain('serveIlConsensoStatistico');
  });
});
