import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
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

/** Ogni quanti minuti gira un lavoro, dalla riga del calendario (minuto ora giorno mese settimana). */
function cadenzaInMinuti(riga: string): number | null {
  const [minuto, ora, giorno, mese, settimana] = riga.trim().split(/\s+/);
  if ([minuto, ora, giorno, mese, settimana].some((c) => c === undefined)) return null;
  const ogni = (campo: string) => (/^\*\/(\d+)$/.exec(campo) ? Number(/^\*\/(\d+)$/.exec(campo)![1]) : null);
  if (ogni(minuto) !== null && ora === '*') return ogni(minuto);
  if (/^\d+$/.test(minuto) && ora === '*') return 60;
  if (/^\d+$/.test(minuto) && ogni(ora) !== null) return 60 * ogni(ora)!;
  if (/^\d+$/.test(minuto) && /^\d+$/.test(ora) && giorno === '*' && mese === '*') {
    return settimana === '*' ? 1440 : 10080;
  }
  return null;
}

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
    // 5/11/2026 (S04, scheda 2344) — «più di zero» accettava qualunque soglia: 3 minuti su un
    // lavoro che gira ogni 5 avrebbero fatto suonare l'allarme a ogni giro. La soglia si lega alla
    // cadenza vera, letta da vercel.json: dev'essere più larga di un giro.
    const calendario = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    const confrontati: string[] = [];
    for (const { path, schedule } of calendario.crons ?? []) {
      const nome = path.replace(/^\/api\/cron\//, '');
      const soglia = CRON_MAX_STALENESS_MIN[nome];
      if (soglia === undefined) continue;
      const cadenza = cadenzaInMinuti(schedule);
      expect(cadenza, `non so leggere la cadenza di ${nome} («${schedule}»)`).not.toBeNull();
      expect(soglia, `${nome}: soglia ${soglia} min su una cadenza di ${cadenza} min, suonerebbe a ogni giro`).toBeGreaterThan(cadenza!);
      confrontati.push(nome);
    }
    expect(confrontati.length, 'nessun lavoro del calendario confrontato con la sua soglia').toBeGreaterThan(0);
  });

  it('il metro della cadenza legge le forme del calendario', () => {
    expect(cadenzaInMinuti('*/5 * * * *')).toBe(5);
    expect(cadenzaInMinuti('0 * * * *')).toBe(60);
    expect(cadenzaInMinuti('0 */6 * * *')).toBe(360);
    expect(cadenzaInMinuti('15 1 * * *')).toBe(1440);
    expect(cadenzaInMinuti('0 4 * * 1')).toBe(10080);
  });
});
