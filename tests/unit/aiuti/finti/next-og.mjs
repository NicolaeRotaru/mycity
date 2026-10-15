/**
 * next/og in finto: l'immagine non si disegna, si tiene quello che c'è scritto sopra.
 *
 * 15/10/2026 (R3) — L'anteprima che WhatsApp mostra quando si incolla il link di un prodotto o di un
 * negozio è un'immagine costruita da un albero di elementi. Alla prova interessa il testo di
 * quell'albero (il nome del negozio c'è o no?), non i pixel: `elemento` lo conserva com'è.
 */
export class ImageResponse {
  constructor(elemento, opzioni) {
    this.elemento = elemento;
    this.opzioni = opzioni;
  }
}
