import { logger } from '@/lib/logger';

/**
 * 5/11/2026 — LA FOTO DEI CONTANTI DEVE ESSERE DI QUESTO FATTORINO, PER QUESTO ORDINE, E ESISTERE.
 *
 * La rotta dei contanti guardava solo la forma del percorso: `fattorino-2/ordine-vecchio/cash.jpg`
 * (un altro ordine, o un file mai caricato) valeva come prova, e sopra i 50 € l'avviso «incasso
 * senza foto» non partiva. Il pannello carica sempre in `<fattorino>/<ordine>/…` (caricaImmagine):
 * un percorso fuori da quella cartella non è una prova di questo incasso.
 *
 * In più, per la foto dei contanti e la firma, si chiede al magazzino `cod-proof` se il file c'è.
 * Se la domanda stessa non riesce si tiene il percorso (con una riga nel registro): il pannello,
 * con la foto caricata, non mostra la casella della nota, e un no qui sarebbe un vicolo cieco alla
 * porta del cliente. Se il magazzino risponde che il file non c'è, vale come «senza foto».
 */
export const SECCHIO_COD_PROOF = 'cod-proof';

export function percorsoDelFattorino(
  percorso: string | null | undefined,
  riderId: string,
  orderId: string,
): string | null {
  if (!percorso) return null;
  return percorso.startsWith(`${riderId}/${orderId}/`) ? percorso : null;
}

type ClientColMagazzino = {
  storage?: {
    from: (secchio: string) => {
      list: (cartella: string, opzioni?: { search?: string; limit?: number }) => Promise<{ data: Array<{ name: string }> | null; error: unknown }>;
    };
  };
};

export async function provaDelFattorino(
  admin: unknown,
  percorso: string | null | undefined,
  riderId: string,
  orderId: string,
): Promise<string | null> {
  const suo = percorsoDelFattorino(percorso, riderId, orderId);
  if (!suo) return null;
  const nome = suo.slice(`${riderId}/${orderId}/`.length);
  try {
    const magazzino = (admin as ClientColMagazzino).storage;
    if (!magazzino) throw new Error('magazzino non disponibile');
    const { data, error } = await magazzino.from(SECCHIO_COD_PROOF).list(`${riderId}/${orderId}`, { search: nome, limit: 100 });
    if (error) throw error;
    return (data ?? []).some((f) => f.name === nome) ? suo : null;
  } catch (e) {
    logger.warn('[cash-confirm] non riesco a controllare che la foto esista: la tengo', {
      orderId,
      message: e instanceof Error ? e.message : String(e),
    });
    return suo;
  }
}
