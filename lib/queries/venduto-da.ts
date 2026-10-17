import { logger } from '@/lib/logger';
import { eSchemaIndietro } from '@/lib/db/migrazione-124';
import type { LettoreVista } from '@/lib/queries/seller-public-profiles';

/**
 * «VENDUTO DA»: chi vende davvero, letto dalla vista pubblica dei negozi.
 *
 * 15/10/2026 (R55) — IN PRODUZIONE IL RIQUADRO SPARIVA, E NESSUNO LO SAPEVA.
 *
 * Il riquadro chiede alla vista `seller_public_profiles` ragione sociale, forma,
 * partita IVA e sede. Quelle colonne le aggiunge la migrazione 126, che in
 * produzione non e' applicata. PostgREST, davanti a una sola colonna che non
 * esiste, fa fallire la domanda intera: il componente ignorava l'errore, il dato
 * restava vuoto e il riquadro non si disegnava. Nessuna riga nei log. Il cliente
 * leggeva solo «Venduto e consegnato da Pane Quotidiano», e chi guardava i log
 * non vedeva niente da guardare.
 *
 * Adesso:
 *  · se la vista non ha ancora le colonne d'impresa, si scrive un avviso che dice
 *    quale migrazione manca, e si mostra quello che la vista ha di sicuro:
 *    insegna, indirizzo del negozio, telefono. Meglio una riga in meno che una
 *    riga finta, ma meglio una riga vera che nessun riquadro;
 *  · se la lettura fallisce per un altro motivo, si scrive l'errore e la domanda
 *    fallisce: non torna «riuscita e vuota».
 *
 * 15/10/2026, secondo giro (R55) — L'AVVISO FINIVA SUL TELEFONO DEL CLIENTE.
 *
 * Il riquadro e' un componente del browser: la lettura la faceva il telefono di
 * chi apriva la scheda, e l'avviso restava nella sua console. Non arrivava ai
 * registri del server e non arrivava a Sentry (il logger manda a Sentry solo gli
 * errori, e in produzione Sentry non e' acceso). Chi cercava nei registri non lo
 * trovava ne' prima ne' dopo la 126.
 *
 * Adesso la domanda la fa PRIMA il server, nel guscio della scheda prodotto e
 * della pagina del negozio (`lib/queries/precarico.ts`): l'avviso e l'errore
 * escono dal processo del server, cioe' nei registri che Vercel conserva. Il
 * browser trova la risposta gia' in mano sotto la STESSA chiave
 * (`domandaVendutoDa`) e non rifa' la lettura. Se il precarico non riesce, il
 * browser legge come prima.
 *
 * Il segnale che la 126 e' arrivata NON e' «l'avviso non c'e' piu'»: un avviso
 * che manca non distingue «e' arrivata» da «nessuno l'ha scritto». La 126 si
 * verifica chiedendo al database le colonne della vista (information_schema).
 *
 * Quello che il codice non puo' fare da solo resta a Nicola: applicare la 126 e
 * far compilare al negozio ragione sociale, sede e partita IVA.
 */

export type DatiVendutoDa = {
  store_name: string | null;
  business_legal_name: string | null;
  business_form: string | null;
  business_vat_number: string | null;
  business_address: string | null;
  business_city: string | null;
  business_zip: string | null;
  store_address: string | null;
  store_phone: string | null;
};

/** Le colonne che la vista ha anche in produzione, senza la migrazione 126. */
export const COLONNE_DI_BASE = 'store_name, store_address, store_phone';

/** Le colonne d'impresa che arrivano con la migrazione 126. */
const COLONNE_IMPRESA = [
  'business_legal_name',
  'business_form',
  'business_vat_number',
  'business_address',
  'business_city',
  'business_zip',
] as const;

type Risposta = { data: unknown; error: unknown };

/** Una riga della vista pubblica dei negozi, con le colonne che si sono chieste. */
export type RigaDellaVista = Record<string, unknown>;

function codiceDi(errore: unknown): string | undefined {
  return (errore as { code?: string } | null)?.code;
}

function messaggioDi(errore: unknown): string | undefined {
  const m = (errore as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m : undefined;
}

/**
 * PERCHE' LA VISTA HA DETTO NO. Tre risposte, e ognuna ha la sua strada.
 *
 *  · `mancano-le-colonne` — lo schema e' indietro (la migrazione 126 non c'e'):
 *    si ripiega sulle colonne di base e si scrive un avviso;
 *  · `id-impossibile` — 22P02, «invalid input syntax for type uuid». L'unica cosa
 *    che la domanda passa al database e' l'id del negozio: se Postgres non riesce
 *    nemmeno a leggerlo come codice, nessun negozio puo' averlo. E' «negozio
 *    inesistente», non un guasto.
 *  · `guasto` — tutto il resto: si scrive l'errore e la domanda fallisce.
 *
 * 16/10/2026 — Il 22P02 finiva fra i guasti. Un robot che prova
 * /store/wp-login.php, o un link tagliato a meta' su WhatsApp, scriveva nei
 * registri «la vista pubblica dei negozi non risponde» con la vista che stava
 * benissimo. E' la riga che R55 ha portato nei registri perche' qualcuno la
 * guardi: piena di falsi allarmi, un guasto vero si sarebbe perso nel rumore.
 */
export type MotivoDelNo = 'mancano-le-colonne' | 'id-impossibile' | 'guasto';

export function motivoDelNo(errore: unknown): MotivoDelNo {
  if (eSchemaIndietro(errore)) return 'mancano-le-colonne';
  if (codiceDi(errore) === '22P02') return 'id-impossibile';
  return 'guasto';
}

/**
 * QUANTO SI RICORDA CHE LA 126 MANCA: dieci minuti, per tutto il processo.
 *
 * 16/10/2026 — La domanda con le colonne d'impresa, in produzione, fallisce di
 * sicuro: la 126 non c'e'. Senza memoria la si rifaceva a OGNI scheda aperta, e
 * dopo il no partiva la domanda ridotta: un viaggio di rete in piu', in fila,
 * prima che il cliente veda il prodotto. Il guscio della scheda gira a ogni
 * visita (`app/layout.tsx` e' `force-dynamic`), quindi lo pagava ogni visita.
 *
 * Adesso il no si ricorda. Per dieci minuti si chiede subito la lettura ridotta;
 * poi si riprova quella completa, cosi' quando la 126 arriva il riquadro torna
 * con ragione sociale e partita IVA entro dieci minuti, senza riavviare niente.
 * La finestra la apre SOLO un no vero del database, mai una lettura che l'ha
 * usata: con traffico continuo deve comunque scadere.
 *
 * L'avviso sulla 126 esce quando il database dice di no, cioe' una volta per
 * finestra e per processo: basta per vederlo nei registri, senza una riga a
 * ogni visita.
 */
const RICORDA_LA_126_MS = 10 * 60_000;
let senza126FinoA = 0;

/** Svuota la memoria della 126. Serve alle prove: nel sito vero scade da sola. */
export function dimenticaLaVistaSenza126(): void {
  senza126FinoA = 0;
}

/**
 * UNA riga della vista pubblica per un negozio: le `colonne` chieste, piu' quelle
 * d'impresa quando la vista le ha.
 *
 * E' la domanda unica che usano «Venduto da» e il guscio della scheda prodotto:
 * il guscio ci mette dentro anche le colonne della scheda, e con un solo viaggio
 * riempie tutte e due le risposte.
 */
export async function leggiNegozioDallaVista(
  supa: LettoreVista,
  sellerId: string,
  colonne: string,
): Promise<RigaDellaVista | null> {
  const chiedi = (select: string): PromiseLike<Risposta> =>
    supa.from('seller_public_profiles').select(select).eq('id', sellerId).maybeSingle();

  if (Date.now() >= senza126FinoA) {
    const completa = await chiedi(`${colonne}, ${COLONNE_IMPRESA.join(', ')}`);
    if (!completa.error) return (completa.data as RigaDellaVista | null) ?? null;

    const motivo = motivoDelNo(completa.error);
    if (motivo === 'id-impossibile') return null;
    if (motivo === 'guasto') {
      logger.error('[venduto-da] la vista pubblica dei negozi non risponde: il riquadro «Venduto da» non si disegna', {
        sellerId,
        codice: codiceDi(completa.error),
        motivo: messaggioDi(completa.error),
      });
      throw completa.error;
    }

    logger.warn(
      '[venduto-da] la vista pubblica dei negozi non ha ancora ragione sociale, partita IVA e sede (migrazione 126 non applicata): mostro insegna, indirizzo e telefono',
      { sellerId, codice: codiceDi(completa.error) },
    );
    const ridotta = await chiedi(colonne);
    if (ridotta.error) return rifiutoDellaRidotta(sellerId, ridotta.error);
    senza126FinoA = Date.now() + RICORDA_LA_126_MS;
    return (ridotta.data as RigaDellaVista | null) ?? null;
  }

  const ridotta = await chiedi(colonne);
  if (ridotta.error) return rifiutoDellaRidotta(sellerId, ridotta.error);
  return (ridotta.data as RigaDellaVista | null) ?? null;
}

function rifiutoDellaRidotta(sellerId: string, errore: unknown): null {
  if (motivoDelNo(errore) === 'id-impossibile') return null;
  logger.error('[venduto-da] anche la lettura ridotta della vista pubblica dei negozi e fallita', {
    sellerId,
    codice: codiceDi(errore),
    motivo: messaggioDi(errore),
  });
  throw errore;
}

/**
 * Il riquadro «Venduto da» da una riga della vista. Prende solo i suoi campi: la
 * riga del guscio porta anche quelli della scheda, e la risposta deve avere la
 * stessa forma che il browser si costruirebbe da solo. Un campo che la vista non
 * ha (le colonne d'impresa senza la 126) resta vuoto: meglio una riga in meno che
 * una riga finta.
 */
export function vendutoDaDaRiga(riga: RigaDellaVista): DatiVendutoDa {
  const campo = (nome: keyof DatiVendutoDa) => (riga[nome] ?? null) as string | null;
  return {
    store_name: campo('store_name'),
    business_legal_name: campo('business_legal_name'),
    business_form: campo('business_form'),
    business_vat_number: campo('business_vat_number'),
    business_address: campo('business_address'),
    business_city: campo('business_city'),
    business_zip: campo('business_zip'),
    store_address: campo('store_address'),
    store_phone: campo('store_phone'),
  };
}

/** Il venditore di un negozio, per il riquadro «Venduto da». `null` se la vista non lo mostra. */
export async function leggiVendutoDa(supa: LettoreVista, sellerId: string): Promise<DatiVendutoDa | null> {
  const riga = await leggiNegozioDallaVista(supa, sellerId, COLONNE_DI_BASE);
  return riga ? vendutoDaDaRiga(riga) : null;
}

/** La chiave della lettura: la stessa per il server che precarica e per il browser che mostra. */
export function chiaveVendutoDa(sellerId: string) {
  return ['venduto-da', sellerId] as const;
}

/**
 * La domanda di «Venduto da», scritta una volta sola.
 *
 * La usano il precarico del server (scheda prodotto e pagina del negozio) e il
 * componente del browser. Se la chiave fosse anche solo un poco diversa, il
 * browser non riconoscerebbe la risposta del server, rifarebbe la lettura e
 * l'avviso tornerebbe a finire solo sul telefono del cliente.
 */
export function domandaVendutoDa(supa: LettoreVista, sellerId: string) {
  return {
    queryKey: chiaveVendutoDa(sellerId),
    queryFn: () => leggiVendutoDa(supa, sellerId),
    staleTime: 10 * 60_000,
  };
}
