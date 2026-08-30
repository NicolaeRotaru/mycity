/**
 * 27/8/2026 (R172) — LA PRIMA PAGINA VISTA DOPO L'ACCETTAZIONE DEI COOKIE NON ARRIVAVA MAI.
 *
 * Google Analytics non è un indirizzo a cui si spedisce: è una coda (`dataLayer`) che la libreria
 * svuota IN ORDINE quando arriva. Un `event` che sta in coda prima del `config` della proprietà non
 * ha una destinazione configurata: si perde.
 *
 * Ed era esattamente quello che succedeva. Appena la persona accetta, `analyticsOn` diventa vero e
 * nello stesso giro di disegno parte l'effetto che accoda la pagina vista — mentre `gtag('js')` e
 * `gtag('config')` venivano montati solo in quel momento, e con la strategia «dopo che la pagina è
 * interattiva». La guardia `!window.gtag` non fermava niente, perché `gtag` esiste già: lo definisce
 * lo script del consenso che gira per primo.
 *
 * Si perdeva la pagina d'ingresso — quella che dice da dove arriva il traffico — proprio per chi
 * accetta i cookie, cioè l'unico gruppo che GA4 può misurare.
 *
 * Qui la coda si costruisce davvero: si esegue lo script di avvio in un finto browser e si guarda
 * in che ordine ci sono finite le istruzioni.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scriptDiAvvioGtag } from '@/lib/analytics/gtag-avvio';

type Comando = [string, ...unknown[]];

/** Esegue lo script di avvio in un finto browser e restituisce la coda che ne esce. */
function codaDopoAvvio(gaId: string): { coda: Comando[]; gtag: (...args: unknown[]) => void } {
  const finestra: Record<string, unknown> = {};
  // Lo script è quello vero, parola per parola: è la stringa che finisce dentro il tag <script>.
  new Function('window', `with (window) { ${scriptDiAvvioGtag(gaId)} }`)(finestra);
  const gtag = finestra.gtag as (...args: unknown[]) => void;
  return { coda: (finestra.dataLayer as unknown as Comando[]) ?? [], gtag };
}

const posizione = (coda: Comando[], comando: string, secondo?: string) =>
  coda.findIndex((c) => c[0] === comando && (secondo === undefined || c[1] === secondo));

describe('la coda che parte verso Google Analytics', () => {
  it('parte sempre col consenso negato: niente si muove prima che la persona scelga', () => {
    const { coda } = codaDopoAvvio('G-TEST123');
    expect(coda[0][0]).toBe('consent');
    expect(coda[0][1]).toBe('default');
    expect((coda[0][2] as Record<string, string>).analytics_storage).toBe('denied');
  });

  it('la proprietà è configurata prima che qualunque evento possa accodarsi', () => {
    const { coda, gtag } = codaDopoAvvio('G-TEST123');
    // Questo è il momento in cui la persona accetta e il sito manda la pagina d'ingresso.
    gtag('event', 'page_view', { page_path: '/' });

    const config = posizione(coda, 'config');
    const evento = posizione(coda, 'event', 'page_view');
    expect(config, 'la proprietà non viene configurata affatto').toBeGreaterThanOrEqual(0);
    expect(config, 'la pagina d\'ingresso arriva prima del config: Google la butta').toBeLessThan(evento);
    expect(posizione(coda, 'js')).toBeLessThan(config);
  });

  it('la pagina vista automatica resta spenta: la manda il sito, una volta sola', () => {
    const { coda } = codaDopoAvvio('G-TEST123');
    const config = coda[posizione(coda, 'config')];
    expect(config[1]).toBe('G-TEST123');
    expect((config[2] as Record<string, unknown>).send_page_view).toBe(false);
    expect((config[2] as Record<string, unknown>).anonymize_ip).toBe(true);
  });

  it('il componente monta quello script, e non ne tiene più uno suo che configura dopo', () => {
    // Controllo di struttura (i componenti React non si montano dentro una prova, qui).
    const src = readFileSync('components/GoogleAnalytics.tsx', 'utf8');
    expect(src).toContain('scriptDiAvvioGtag');
    const dopoInterattiva = src.slice(src.indexOf('afterInteractive'));
    expect(dopoInterattiva, 'il config è di nuovo dietro allo script caricato dopo').not.toContain("gtag('config'");
  });
});
