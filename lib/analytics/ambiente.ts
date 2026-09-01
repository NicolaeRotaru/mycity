/**
 * DA QUALE AMBIENTE ARRIVA QUESTO ERRORE.
 *
 * Radiografia del 27/8/2026 (R187). Tutti e tre i punti in cui si accende
 * Sentry dichiaravano `environment: process.env.NODE_ENV`. Su Vercel `NODE_ENV`
 * vale `production` in ogni pubblicazione compilata: le anteprime di ogni ramo,
 * i rilasci di prova e il sito vero finivano tutti nello stesso mucchio.
 *
 * La conseguenza non e' estetica. Chi guarda gli errori per capire se i clienti
 * stanno male legge dentro lo stesso elenco gli errori di un ramo di lavoro
 * ancora a meta'. Il rumore delle anteprime copre il segnale della produzione,
 * e dopo un po' quell'elenco non lo apre piu' nessuno.
 *
 * `VERCEL_ENV` distingue davvero: vale `production`, `preview` o `development`.
 * Fuori da Vercel non esiste, e allora si ripiega su `NODE_ENV` — che in locale
 * e' esattamente la risposta giusta.
 */
export function ambienteSentry(): string {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
}
