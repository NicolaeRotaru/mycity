import { toast } from 'sonner';
import { avvisoDopoIlPatch, type AvvisoDopoIlPatch, type EsitoPatchModulo } from '@/lib/products/aiPatch';

/**
 * Mostra la frase che segue un suggerimento dell'assistente applicato al modulo
 * del prodotto. Quale frase, e con quale colore, lo decide `avvisoDopoIlPatch`:
 * qui si sceglie solo l'avviso giusto per quel colore.
 */
export function dilloDopoIlPatch(
  esito: Pick<EsitoPatchModulo, 'cambiati' | 'inSospeso'>,
  testi: { applicato: string; niente: string },
  opzioni?: { id?: string | number },
): AvvisoDopoIlPatch {
  const avviso = avvisoDopoIlPatch(esito, testi);
  if (avviso.tono === 'successo') toast.success(avviso.testo, opzioni);
  else if (avviso.tono === 'da-controllare') toast.warning(avviso.testo, opzioni);
  else toast(avviso.testo, opzioni);
  return avviso;
}
