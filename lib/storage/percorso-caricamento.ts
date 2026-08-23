/**
 * DOVE SI PUÒ CARICARE UN FILE — una casa sola per una regola che vive nel database.
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────────────────────
 * La regola di scrittura sul secchio `products` sta scritta in SQL
 * (`migrations/114_hardening_radiografia.sql`): passa solo un percorso la cui PRIMA cartella è
 * l'identificativo di chi carica, oppure la cartella `home` se chi carica è uno staff.
 *
 * Nel codice quella regola non aveva nessuna casa: ogni punto che carica si costruiva il percorso
 * a mano, con una stringa. Dieci punti, e tre l'hanno scritto in un modo che il database rifiuta:
 *
 *   · `components/StoreMediaManager.tsx`  → `store-media/…`  (la copertina del negozio)
 *   · `components/ImageUrlField.tsx`      → `events/…`       (le copertine degli eventi in admin)
 *   · `components/ImageUrlField.tsx`      → `shop/…`         (il negozio del mese in admin)
 *
 * Conseguenza vera, misurata sul codice il 23/8/2026: un negoziante NON riesce a mettere la foto
 * di copertina alla sua vetrina — per nessun negozio, mai — e la pagina resta sul gradiente di
 * ripiego. Non è un errore raro: è il caso normale.
 *
 * Non è che chi ha scritto quei tre punti fosse distratto. Non c'era niente da chiamare: la regola
 * era una frase in un file SQL che nessuno importa. Con dieci copie a mano, che due o tre siano
 * sbagliate non è sfortuna — è l'esito atteso, e il prossimo punto che nasce è un'altra moneta
 * lanciata in aria.
 *
 * 🟢 Modulo PURO: nessuna rete, nessun file, nessun orologio preso da dentro. Il timestamp arriva
 *    da fuori, così una prova può ESEGUIRE questa regola invece di cercarne una parola nel codice.
 */

/** La cartella che il database concede allo staff, ed è l'unica eccezione scritta nella regola. */
export const CARTELLA_STAFF = 'home';

/** Il secchio pubblico a cui questa regola si applica. */
export const SECCHIO_PUBBLICO = 'products';

/**
 * Questo percorso lo accetterebbe il database?
 *
 * È la traduzione in codice della `WITH CHECK` della migrazione 114 — la stessa domanda, fatta
 * prima di partire invece che dopo aver ricevuto un errore che l'utente legge come «non funziona».
 */
export function percorsoAmmesso(
  percorso: string,
  { userId, staff = false }: { userId?: string | null; staff?: boolean },
): { ammesso: boolean; motivo: string } {
  const pulito = String(percorso ?? '').replace(/^\/+/, '');
  if (!pulito) return { ammesso: false, motivo: 'percorso vuoto' };
  const prima = pulito.split('/')[0];
  if (!pulito.includes('/')) {
    return {
      ammesso: false,
      motivo: `«${pulito}» è un file nella radice del secchio: la regola pretende una prima cartella`,
    };
  }
  if (userId && prima === userId) {
    return { ammesso: true, motivo: 'la prima cartella è chi carica' };
  }
  if (prima === CARTELLA_STAFF) {
    return staff
      ? { ammesso: true, motivo: 'cartella dello staff, e chi carica è staff' }
      : { ammesso: false, motivo: `la cartella «${CARTELLA_STAFF}» la scrive solo lo staff` };
  }
  return {
    ammesso: false,
    motivo:
      `la prima cartella è «${prima}»: il database accetta solo l'identificativo di chi carica` +
      ` o «${CARTELLA_STAFF}» per lo staff. Un nome di comodo qui fa rifiutare ogni caricamento.`,
  };
}

/** Il pezzo che rende unico un nome, tenuto fuori così le prove non dipendono dall'orologio. */
function suffisso(quando: number, caso: string): string {
  return `${quando}-${caso}`;
}

export function estensioneDi(nomeFile: string, difetto = 'bin'): string {
  const e = String(nomeFile ?? '').split('.').pop();
  if (!e || e === nomeFile || !/^[a-z0-9]{1,8}$/i.test(e)) return difetto;
  return e.toLowerCase();
}

/**
 * Il percorso di chi carica per sé — la strada normale, quella di ogni negoziante.
 *
 * `cartella` è il sotto-raggruppamento (logos, site, store-media, …) e sta DOPO l'identificativo,
 * dove il database non guarda: è lì che finivano i nomi di comodo che facevano rifiutare tutto.
 */
export function percorsoUtente(
  userId: string,
  cartella: string,
  nomeFile: string,
  { quando, caso }: { quando: number; caso: string },
): string {
  if (!userId) throw new Error('percorsoUtente senza identificativo: il database lo rifiuterebbe');
  const dentro = String(cartella ?? '').replace(/^\/+|\/+$/g, '');
  const coda = `${suffisso(quando, caso)}.${estensioneDi(nomeFile)}`;
  return dentro ? `${userId}/${dentro}/${coda}` : `${userId}/${coda}`;
}

/** Il percorso dello staff: l'unica eccezione che la regola concede, e va usata come tale. */
export function percorsoStaff(
  cartella: string,
  nomeFile: string,
  { quando, caso }: { quando: number; caso: string },
): string {
  const grezzo = String(cartella ?? '').replace(/^\/+|\/+$/g, '');
  // Chi passa già «home» sta nominando la cartella dello staff, non una sotto-cartella che si
  // chiama così: `home/home/…` sarebbe un percorso legale ma assurdo, e cambierebbe di posto i file
  // di un chiamante che oggi funziona (il banner della home). Assorbirlo qui costa una riga e
  // toglie a ogni chiamante il bisogno di sapere com'è fatta la regola — che è il punto del file.
  const dentro = grezzo === CARTELLA_STAFF ? '' : grezzo;
  const coda = `${suffisso(quando, caso)}.${estensioneDi(nomeFile)}`;
  return dentro ? `${CARTELLA_STAFF}/${dentro}/${coda}` : `${CARTELLA_STAFF}/${coda}`;
}

/** Il caso casuale, isolato qui perché le prove possano passarne uno fisso. */
export function casoNuovo(): string {
  return Math.random().toString(36).slice(2, 8);
}
