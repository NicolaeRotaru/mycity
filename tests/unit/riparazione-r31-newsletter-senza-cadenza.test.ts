import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R31-009 (prova leggera, testo) — Nessun invio di newsletter esiste: né il riquadro della home
 * né le impostazioni promettono una cadenza («ogni venerdì», «mensile», «una volta a settimana»).
 * Le due pagine dicono la stessa cosa: «Newsletter», senza giorni né frequenze.
 */
const CADENZA = /mensil|settimanal|una volta a settimana|ogni venerd|ogni settimana|ogni mese|quotidian/i;

function tratto(file: string, da: string, lunghezza: number): string {
  const src = readFileSync(file, 'utf8');
  const i = src.indexOf(da);
  expect(i, `${file}: «${da}» non trovato`).toBeGreaterThan(-1);
  return src.slice(i, i + lunghezza);
}

describe('la newsletter non promette una cadenza che non esiste', () => {
  it('impostazioni: l’etichetta dell’interruttore non dice «mensile» né altra frequenza', () => {
    const t = tratto('app/profile/settings/page.tsx', 'NEWSLETTER_ACCESA || prefs.notif_newsletter', 700);
    expect(t).toContain('Newsletter');
    expect(t).not.toMatch(CADENZA);
  });

  it('home: il riquadro newsletter non dice giorno né frequenza', () => {
    const src = readFileSync('components/home-sections/HomeSectionRenderer.tsx', 'utf8');
    const i = src.indexOf("case 'newsletter'");
    const fine = src.indexOf('<NewsletterForm', i);
    const t = src
      .slice(i, fine > i ? fine : i + 3000)
      .split('\n')
      .filter((r) => !r.trim().startsWith('//') && !r.trim().startsWith('{/*'))
      .join('\n');
    expect(t).toContain('Le novità dei negozi di Piacenza');
    expect(t).not.toMatch(CADENZA);
  });
});
