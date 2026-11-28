/**
 * ARMONIA NASCOSTA — la base di ogni sito che facciamo e del marketplace (Nicola, 28/11/2026).
 *
 * Proporzioni (sezione aurea, Fibonacci), numeri (numerologia del nome), cielo (segno, pianeta,
 * luna, wu xing, i sedici settori etruschi), forme di più culture e magia (quadrati magici dei
 * pianeti, sigillo dell'intenzione). Chi visita non vede simboli: sente solo un sito ordinato.
 *
 * Come si usa: `firmaDi({ nome, data })`, poi `tokenCss(firma)` nello style del contenitore,
 * `<TramaNascosta firma={…} />` e `<LunaDiOggi />` da `components/armonia`, e
 * `ordineDiAccensione(firma.pianeta, n)` per l'ordine in cui compaiono le schede.
 * La regola, i vietati e cosa usare dove: skill `armonia` nella repo ad-mycity.
 */
export * from './numeri';
export * from './cielo';
export * from './quadrati';
export * from './forme';
export * from './simboli';
export * from './firma';
