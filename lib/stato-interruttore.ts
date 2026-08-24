/**
 * I tre stati di un interruttore che dipende da una lettura: il cuore dei preferiti, il bottone
 * «Segui», e ogni altro comando che prima deve sapere com'è messo adesso.
 *
 * PERCHÉ ESISTE. Un interruttore ha due posizioni, quindi il codice ne prevede due — e la terza,
 * «non sono riuscito a leggere com'è messo», finisce dentro una delle due. Finisce sempre nella
 * stessa: `false`. Il cuore diceva «non è fra i preferiti» a chi ce l'aveva salvato, e il bottone
 * diceva «Segui» a chi il negozio lo segue già.
 *
 * E non è solo un'etichetta sbagliata: **premerlo fa il danno**. Chi comanda l'interruttore decide
 * se aggiungere o togliere guardando lo stato letto. Su uno stato non letto sceglie a caso — sul
 * «Segui» tenta un inserimento doppio, che il database rifiuta, e il bottone non fa niente.
 *
 * Per questo `spento` non vuol dire «si può premere»: si può premere solo quando si è LETTO.
 */
export type StatoInterruttore = 'acceso' | 'spento' | 'non-lo-so';

/**
 * @param letto  c'è una risposta in mano — NON «la lettura è finita». Con la lettura finita male
 *               la seconda direbbe di sì, ed è esattamente il buco da cui passava il difetto.
 * @param dentro com'è messo, secondo quella risposta.
 */
export function statoInterruttore({ letto, dentro }: { letto: boolean; dentro: boolean }): StatoInterruttore {
  if (!letto) return 'non-lo-so';
  return dentro ? 'acceso' : 'spento';
}

/** Si può agire solo su uno stato letto: su «non lo so» il comando sceglierebbe a caso. */
export function siPuoPremere(stato: StatoInterruttore): boolean {
  return stato !== 'non-lo-so';
}

/** Acceso davvero, cioè letto E dentro. «Non lo so» non è mai un sì. */
export function eAcceso(stato: StatoInterruttore): boolean {
  return stato === 'acceso';
}
