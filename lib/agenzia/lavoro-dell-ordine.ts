import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import type { Abbonamento } from './preventivo';
import type { StatoPianoCompleto } from './ordine-sdg';
import type { PianoDelMese } from './piano-del-primo-mese';
import type { BozzaSitoOrdine } from './sito-dell-ordine-ad';
import type { AnalisiAvvioOrdine } from './analisi-dell-ordine-ad';
import { leggiServiziScelti, servizioScelto, type ServizioAgenzia } from './servizi-scelti';
import { percorsoDelSito } from './sito-finito/indirizzo';
import { indirizzoPubblico } from '@/lib/env';

/**
 * IL LAVORO DELL'ORDINE, VISTO DAL TITOLARE — 28/11/2026.
 *
 * SOLO LATO SERVER (la rotta /api/seller/lavoro-consegnato). Il titolare vede nella zona «Servizi» quello che è nato
 * con il suo ordine: il sito (online dal 28/11, rotta app/sito), il piano editoriale, l'analisi all'avvio. Piano e
 * analisi restano bozze, «le confermiamo insieme alla visita».
 *
 * La tabella ordini_sdg dal browser il titolare non la legge (RLS della 999c): qui legge il server, con la chiave di
 * servizio, e SOLO la riga del negozio che è entrato (`sellerId` viene dall'accesso, mai dalla richiesta). Escono
 * solo i tre lavori e il loro stato: mai l'email dell'agente, mai il codice dei lavori in n8n, mai i motivi degli
 * errori (sono per SDG), mai il canone.
 *
 * Prima della 999h le colonne di sito e analisi non ci sono: si legge solo il piano, e gli altri due dicono
 * «lo stiamo preparando». Se anche l'ordine non si legge, `null`: la pagina resta quella di sempre.
 */

/**
 * Per il titolare: c'è («pronto»), l'AD ci sta lavorando («in_preparazione»: pronto entro poche ore), oppure non è
 * ancora partito o è andato storto («lo_stiamo_preparando»): i motivi sono cose di SDG, mai un errore tecnico.
 */
export type StatoPerIlTitolare = 'pronto' | 'in_preparazione' | 'lo_stiamo_preparando';
const perIlTitolare = (stato: StatoPianoCompleto | undefined, c_e: boolean): StatoPerIlTitolare =>
  stato === 'pronto' && c_e ? 'pronto' : stato === 'in_corso' ? 'in_preparazione' : 'lo_stiamo_preparando';
export type LavoroDellOrdine = {
  fascia: Abbonamento;
  /** 28/11 — I servizi scelti dall'agente: solo le loro voci del menu mostrano il lavoro. `null` = tutti. */
  servizi: ServizioAgenzia[] | null;
  nomeAttivita: string;
  piano: { stato: StatoPerIlTitolare; piano: PianoDelMese };
  /**
   * 28/11/2026 (Nicola, 14:10: «deve essere già su Vercel») — `indirizzo` è il sito online, intero
   * («https://www.mycity-marketplace.com/sito/raquel-cafe-ffb27af9»): c'è appena il sito è pronto ed è fra i servizi scelti.
   */
  sito: { stato: StatoPerIlTitolare; bozza: BozzaSitoOrdine | null; indirizzo: string | null };
  analisi: { stato: StatoPerIlTitolare; analisi: AnalisiAvvioOrdine | null };
};

type Riga = {
  seller_id: string;
  nome_attivita: string;
  fascia: Abbonamento;
  piano: PianoDelMese;
  piano_completo_stato: StatoPianoCompleto;
  dati_attivita?: { servizi?: unknown } | null;
  sito?: BozzaSitoOrdine | null;
  sito_stato?: StatoPianoCompleto;
  analisi?: AnalisiAvvioOrdine | null;
  analisi_stato?: StatoPianoCompleto;
};

const BASE = 'seller_id, nome_attivita, fascia, piano, piano_completo_stato, dati_attivita';
const CON_I_PEZZI = `${BASE}, sito, sito_stato, analisi, analisi_stato`;

export async function lavoroDallOrdine(sellerId: string): Promise<LavoroDellOrdine | null> {
  const id = typeof sellerId === 'string' ? sellerId.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null;
  try {
    const admin = getAdminSupabase();
    let letto: { data: unknown; error: { message: string } | null } = await admin.from('ordini_sdg').select(CON_I_PEZZI).eq('seller_id', id).maybeSingle();
    // Prima della 999h: solo il piano.
    if (letto.error && /column|does not exist/i.test(letto.error.message)) letto = await admin.from('ordini_sdg').select(BASE).eq('seller_id', id).maybeSingle();
    if (letto.error || !letto.data) return null;
    const r = letto.data as unknown as Riga;
    // Una seconda volta, per sicurezza: la riga è di chi è entrato, o niente.
    if (String(r.seller_id).toLowerCase() !== id) return null;
    const sitoPronto = r.sito_stato === 'pronto' && !!r.sito;
    const analisiPronta = r.analisi_stato === 'pronto' && !!r.analisi;
    const servizi = leggiServiziScelti(r.dati_attivita?.servizi, null).servizi;
    const percorso = sitoPronto && servizioScelto(servizi, 'sito_web') ? percorsoDelSito(id, r.nome_attivita) : null;
    return {
      fascia: r.fascia,
      // Solo l'elenco dei servizi: la nota dell'agente e il resto di dati_attivita restano a SDG.
      servizi,
      nomeAttivita: r.nome_attivita,
      // Collaudo 28/11/2026 — Le «note» del piano e della bozza sono righe dell'AD per il team (cosa preparare alla
      // visita, cosa manca): restano a SDG, al titolare non si mandano nemmeno nella risposta.
      piano: { stato: perIlTitolare(r.piano_completo_stato, true), piano: r.piano ? { ...r.piano, note: [] } : r.piano },
      sito: { stato: perIlTitolare(r.sito_stato, sitoPronto), bozza: sitoPronto && r.sito ? { ...r.sito, note: [] } : null, indirizzo: percorso ? `${indirizzoPubblico().url}${percorso}` : null },
      analisi: { stato: perIlTitolare(r.analisi_stato, analisiPronta), analisi: analisiPronta ? (r.analisi ?? null) : null },
    };
  } catch (e) {
    logger.warn('[lavoro-dell-ordine] lettura non riuscita', { errore: String(e) });
    return null;
  }
}
