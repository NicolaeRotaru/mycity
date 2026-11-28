/**
 * DOVE PORTA UNA NOTIFICA, SECONDO CHI LA APRE — 28/11/2026.
 *
 * Nicola, dal telefono, alle 15:45: entrato come amministratore, preme la campanella, preme la notifica
 * e «mi manda nella versione venditore». La causa: l'avviso «Ordine di servizio per SDG: …»
 * (lib/agenzia/ordine-sdg.ts) va solo agli amministratori, ma portava a /seller/ordini-sdg, la pagina
 * del negozio SDG. Il portiere lascia entrare l'admin anche nell'area negozio (middleware.ts,
 * `ROLE_PROTECTED`), e lì si apre il guscio del venditore, col menu del venditore: Nicola si ritrovava
 * nel pannello di un negozio senza averlo chiesto.
 *
 * Il link alla fonte ora è /admin/ordini-sdg, la stessa pagina dentro l'admin. Ma nel database restano
 * le notifiche già scritte col link vecchio (tre il 28/11: PROVA SDG, Raquel Cafè, Movida Cafè).
 * Invece di riscriverle, la campanella e il Centro notifiche girano il link nel momento in cui lo
 * mostrano. La regola è una sola: **per l'amministratore nessuna notifica apre l'area negozio**.
 * Se la pagina ha un doppione nell'admin si va lì; altrimenti si va al cruscotto dell'admin.
 * Per tutti gli altri il link resta com'è.
 */

/** Le pagine del negozio che hanno la loro gemella dentro l'admin. L'ordine conta: la più specifica prima. */
const GEMELLE_NELL_ADMIN: ReadonlyArray<{ negozio: RegExp; admin: (pezzi: RegExpExecArray) => string; tieniCoda: boolean }> = [
  // La stessa pagina (components/sdg/OrdiniSdg.tsx): anche la coda (?…#…) vale uguale.
  { negozio: /^\/seller\/ordini-sdg\/?$/, admin: () => '/admin/ordini-sdg', tieniCoda: true },
  // Il dettaglio di un ordine: l'admin lo apre con lo stesso identificativo.
  { negozio: /^\/seller\/orders\/([^/]+)\/?$/, admin: (p) => `/admin/orders/${p[1]}`, tieniCoda: false },
  { negozio: /^\/seller\/orders\/?$/, admin: () => '/admin/orders', tieniCoda: false },
  // Un prodotto preciso (l'identificativo ha almeno una cifra: «new» e «ai-batch» no) apre la sua scheda nell'admin.
  { negozio: /^\/seller\/products\/([^/]*\d[^/]*)(\/edit)?\/?$/, admin: (p) => `/admin/products/${p[1]}`, tieniCoda: false },
  { negozio: /^\/seller\/products(\/.*)?$/, admin: () => '/admin/products', tieniCoda: false },
  { negozio: /^\/seller\/preventivo(\/.*)?$/, admin: () => '/admin/preventivi', tieniCoda: false },
];

/** Vero se il percorso sta nell'area negozio: «/seller» o «/seller/…», non «/sellers». */
function eAreaNegozio(percorso: string): boolean {
  return percorso === '/seller' || percorso.startsWith('/seller/');
}

/**
 * Il link da aprire per chi guarda. `link` è quello scritto nella notifica (un percorso del sito).
 * Per l'amministratore un link dell'area negozio diventa quello dell'admin; il resto non cambia.
 */
export function indirizzoDellaNotifica(link: string, chiApre: { isAdmin: boolean }): string {
  if (!chiApre.isAdmin) return link;
  const taglio = link.search(/[?#]/);
  const percorso = taglio === -1 ? link : link.slice(0, taglio);
  const coda = taglio === -1 ? '' : link.slice(taglio);
  if (!eAreaNegozio(percorso)) return link;
  for (const g of GEMELLE_NELL_ADMIN) {
    const pezzi = g.negozio.exec(percorso);
    if (pezzi) return g.admin(pezzi) + (g.tieniCoda ? coda : '');
  }
  return '/admin';
}
