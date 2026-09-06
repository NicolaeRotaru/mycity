/**
 * 6/9/2026 — ALLE UNDICI DI SERA IL CARRELLO DICEVA «CONSEGNA IN 30-60 MIN». LA CASSA DICEVA DOMANI.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────────
 * Le due righe di disponibilità del carrello — «Disponibile · …» e «Ne restano solo N · …» —
 * chiudevano sempre con la stessa coda, perché quei minuti erano scritti lì dentro a mano. Non
 * guardavano l'orologio.
 *
 * La cassa, un clic dopo, l'orologio lo guarda: offre «Adesso» solo mentre un rider c'è davvero,
 * fra le 8 e le 21 (`expressSiPuo`), e passate le 20 parte già da domani (`giornoDiPartenza`).
 * Alle 22:00 la stessa persona leggeva mezz'ora nel carrello e trovava domani mattina allo schermo
 * successivo. È la sorpresa all'ultimo passo, quella che fa abbandonare: la stessa forma di
 * difetto già tolta dalla promessa sulla spedizione.
 *
 * ── Cosa prova questo file, e cosa NON prova ────────────────────────────────────────────────────
 * In questa repo i componenti React non si montano (la pagina è .tsx e il transform dei test non
 * la compila): la prova fa quindi le due cose che può fare davvero.
 *
 *   ① ESEGUE i due orologi veri, quelli che usa la cassa. Non cerca parole: chiama `expressSiPuo`
 *      e `giornoDiPartenza` alle ore che contano. Se domani qualcuno sposta `CHIUSURA_EXPRESS`,
 *      questi numeri si muovono da soli e la prova continua a dire la verità.
 *   ② LEGGE il carrello e pretende che la sua frase nasca da lì: nessun minuto battuto a mano,
 *      la mezz'ora solo dentro il ramo `expressSiPuo`, e le parole di ripiego per quando il rider
 *      non c'è.
 *
 * ⚠️ Cosa NON prova: che su un browser vero, alle 22:00, la riga a video dica «Consegna domani».
 * Qui non c'è niente che disegni la pagina. Si prova che la regola con cui la frase è costruita è
 * quella giusta e che il numero non è più ricopiato.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';
import {
  APERTURA_EXPRESS,
  CHIUSURA_EXPRESS,
  expressSiPuo,
  giornoDiPartenza,
} from '@/lib/quando-arriva';

const SORGENTE = readFileSync(join(process.cwd(), 'app/cart/page.tsx'), 'utf8');

/** Le righe di codice senza i commenti: quello che ci scriviamo dentro nessuno lo legge a video. */
const righeVive = (sorgente: string): string[] =>
  sorgente.split('\n').filter((r) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(r));

const VIVE = righeVive(SORGENTE);
const CODICE = VIVE.join('\n');

describe('alle undici di sera la consegna in mezz\'ora non esiste', () => {
  it('la cassa non offre l\'express alle 22, e riparte da domani', () => {
    expect(expressSiPuo(22), 'a quest\'ora nessun rider è in strada').toBe(false);
    expect(giornoDiPartenza(22), 'la cassa apre già su domani').toBe('tomorrow');
  });

  it('e nemmeno alle 7 del mattino — ma lì il giorno è ancora oggi', () => {
    expect(expressSiPuo(7)).toBe(false);
    expect(giornoDiPartenza(7), 'alle 7 la fascia delle 15:00-18:00 c\'è ancora').toBe('today');
  });

  it('mentre in pieno orario l\'express c\'è, e non va perso per eccesso di prudenza', () => {
    expect(expressSiPuo(APERTURA_EXPRESS)).toBe(true);
    expect(expressSiPuo(14)).toBe(true);
    // Le 20 sono l'ora di punta della cena: qui l'express si offre ancora.
    expect(expressSiPuo(CHIUSURA_EXPRESS - 1)).toBe(true);
    expect(expressSiPuo(CHIUSURA_EXPRESS)).toBe(false);
  });
});

describe('il carrello chiede l\'ora invece di scrivere sempre lo stesso numero', () => {
  it('i minuti non sono più battuti a mano da nessuna parte', () => {
    expect(
      VIVE.filter((r) => r.includes(EXPRESS_ETA_LABEL)),
      `«${EXPRESS_ETA_LABEL}» è tornato scritto a mano nel carrello`,
    ).toEqual([]);
    expect(CODICE, 'la mezz\'ora si chiede a EXPRESS_ETA_LABEL').toContain('EXPRESS_ETA_LABEL');
  });

  it('la promessa dell\'express sta dentro il ramo che guarda l\'orologio', () => {
    expect(CODICE).toMatch(/if \(expressSiPuo\(ora\)\) return `Consegna in \$\{EXPRESS_ETA_LABEL\}`/);
  });

  it('e quando il rider non c\'è dice quello che la cassa offrirà davvero', () => {
    expect(CODICE).toContain("giornoDiPartenza(ora) === 'today'");
    expect(CODICE, 'alle 7 del mattino la consegna è in giornata').toContain("'Consegna in giornata'");
    expect(CODICE, 'alle 22 la consegna è domani').toContain("'Consegna domani'");
  });

  it('le due righe di disponibilità usano quella frase, non una loro', () => {
    const conLaFrase = VIVE.filter((r) => r.includes('${quando}'));
    expect(conLaFrase, 'le righe sono due: «Ne restano solo N» e «Disponibile»').toHaveLength(2);
    expect(CODICE).toContain('const quando = quandoArrivaScrittoNelCarrello(oraDiAdesso);');
  });

  it('l\'ora si legge nel browser, non nell\'HTML che arriva dal server', () => {
    // Partire da `new Date()` dentro `useState` significherebbe promettere l'ora del server e
    // cambiarla subito dopo: si parte da `null`, e finché è `null` non si promette nessun tempo.
    expect(CODICE).toContain('const [oraDiAdesso, setOraDiAdesso] = useState<number | null>(null);');
    expect(CODICE).toContain('if (ora === null) return null;');
    // Un carrello lasciato aperto attraversa le 21: l'ora si rilegge da sola.
    expect(CODICE).toContain('setInterval(leggiLOra');
  });
});
