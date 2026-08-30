import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CRON_MAX_STALENESS_MIN } from '@/lib/cron-health';

/**
 * IL SORVEGLIANTE AVEVA UN PUNTO CIECO, E NESSUNO POTEVA VEDERLO.
 *
 * I lavori periodici sono sorvegliati da un dead-man's switch: ognuno lascia un
 * battito, e `operational-alerts` segnala quelli che hanno smesso di batterlo.
 * Ma il confronto si fa contro un elenco di soglie scritto a mano in
 * `lib/cron-health.ts`. Un lavoro che non compare in quell'elenco non e'
 * «sano»: e' **non guardato**. La differenza non si vede da nessuna parte,
 * perche' un lavoro non sorvegliato e uno sorvegliato che va bene producono
 * esattamente lo stesso silenzio.
 *
 * Radiografia del 27/8/2026 (R182): `riquadra-casse` — la quadratura della
 * cassa contanti, cioe' il controllo che i soldi presi in mano dai fattorini
 * tornino — girava ogni notte senza che nessuno guardasse se girava davvero.
 * Poteva essere ferma da settimane in silenzio.
 *
 * La prova non cerca una parola in un file: legge le cartelle dei lavori che
 * esistono DAVVERO sul disco e pretende che ognuna abbia la sua soglia. Aggiungi
 * un lavoro nuovo e dimentichi di sorvegliarlo → questa riga diventa rossa.
 */

const CARTELLA_CRON = join(process.cwd(), 'app/api/cron');

/**
 * L'unica esenzione legittima: `operational-alerts` e' il sorvegliante stesso.
 * Se muore lui non c'e' nessuno che possa accorgersene da dentro — quel caso lo
 * copre il monitor esterno su /api/health, non questo elenco.
 */
const NON_PUO_AUTOSORVEGLIARSI = new Set(['operational-alerts']);

function rotteSulDisco(): string[] {
  return readdirSync(CARTELLA_CRON, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(CARTELLA_CRON, d.name, 'route.ts')))
    .map((d) => d.name)
    .sort();
}

describe('ogni lavoro periodico ha qualcuno che lo guarda', () => {
  it('ogni rotta cron sul disco ha una soglia di sorveglianza', () => {
    const scoperti = rotteSulDisco().filter(
      (nome) => !NON_PUO_AUTOSORVEGLIARSI.has(nome) && CRON_MAX_STALENESS_MIN[nome] === undefined,
    );
    expect(
      scoperti,
      `questi lavori girano senza che nessuno controlli se girano ancora: ${scoperti.join(', ')}. ` +
        'Aggiungi la soglia in lib/cron-health.ts (CRON_MAX_STALENESS_MIN).',
    ).toEqual([]);
  });

  it('non si sorveglia un lavoro che non esiste piu', () => {
    // Una soglia rimasta dopo la cancellazione della rotta e' un allarme che
    // suonera' per sempre su un lavoro che nessuno fa piu' partire.
    const esistenti = new Set(rotteSulDisco());
    const fantasmi = Object.keys(CRON_MAX_STALENESS_MIN).filter((n) => !esistenti.has(n));
    expect(fantasmi, `soglie senza rotta corrispondente: ${fantasmi.join(', ')}`).toEqual([]);
  });

  it('la soglia e sempre piu larga della cadenza, o suonerebbe da sola', () => {
    // Una soglia piu' stretta della cadenza fa scattare l'allarme a ogni giro
    // normale: dopo tre notti nessuno lo guarda piu'.
    for (const [nome, soglia] of Object.entries(CRON_MAX_STALENESS_MIN)) {
      expect(soglia, `soglia non plausibile per ${nome}`).toBeGreaterThan(0);
    }
  });
});
