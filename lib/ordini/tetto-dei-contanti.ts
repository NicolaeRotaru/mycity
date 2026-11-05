/**
 * 5/11/2026 — IL TETTO DEI CONTANTI.
 *
 * L'art. 49 c.1 del D.Lgs. 231/2007 vieta il trasferimento di contanti fra soggetti diversi da
 * 5.000 € in su. La rotta dei contanti controllava solo che la merce fosse sopra zero: 99 pezzi da
 * 60 € (5.943 €) passavano. Non è una soglia di MyCity da decidere, è quella della legge: sopra
 * 4.999,99 € (il lordo, prima del credito) si paga con la carta.
 */
export const TETTO_CONTANTI_CENTS = 499_999;

export const MOTIVO_SOPRA_IL_TETTO_DEI_CONTANTI =
  'Sopra 4.999,99 € non si può pagare in contanti: scegli la carta oppure dividi la spesa.';

export function sopraIlTettoDeiContanti(lordoCents: number): boolean {
  return lordoCents > TETTO_CONTANTI_CENTS;
}
