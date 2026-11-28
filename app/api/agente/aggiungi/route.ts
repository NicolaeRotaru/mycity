// POST /api/agente/aggiungi { lavoro } — il pulsante «Aggiungi attività» della pagina dell'agente (27/11/2026).
//
// Nicola: il preventivo nasce solo quando il titolare dice «sì, voglio aderire», e va fatto «con un clic
// dalla stessa pagina». L'agente ha la scheda davanti, il titolare dice sì, l'agente preme il pulsante:
//  1. si rilegge la scheda di QUEL lavoro dal server (mai i dati mandati dal browser), e solo se è sua
//     (l'admin le vede tutte, come in /api/agente/stato);
//  2. l'attività si iscrive come fa il flusso 20: nascosta, senza accesso, col suo link col codice
//     (lib/agenzia/nuova-attivita.ts). Premere due volte non crea un doppione: ridà lo stesso link;
//  3. partono gli stessi passi del modulo 12 (lib/agenzia/dopo-iscrizione.ts), e Nicola riceve l'avviso;
//  4. all'agente torna il link del preventivo da mandare al titolare. Il sito non manda niente da solo.
// Il pagamento, per ora, è in contanti (lib/agenzia/pagamento-servizi.ts).
//
// 27/11/2026 02:26 — Nicola: «bisogna selezionare di che abbonamento ha scelto l'imprenditore», e «in automatico
// deve sbloccarsi la pagina del venditore in base all'abbonamento». L'agente sceglie Base, Business o Premium
// prima del «Sì»; la scelta va sul preventivo (il link si apre su quella fascia) e la pagina del negozio si
// sblocca subito in quella fascia, fino alla disdetta: i contanti si ritirano al primo servizio
// (lib/agenzia/abbonamento-contanti.ts, migrazione 999).

import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';
import { getAdminSupabase } from '@/lib/supabase/server';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { conAgente } from '@/lib/agenti/rotta';
import { leggiLavoro } from '@/lib/agenti/n8n';
import { normalizza, pulisci, unisci } from '@/lib/agenti/scheda';
import { attivitaDallaScheda, linkDelPreventivo, nomeNonValido, segnaChiHaPortatoIlCliente, segnaIServiziScelti, stessoIndirizzo } from '@/lib/agenti/aggiungi';
import { ETICHETTE_SERVIZI, ServiziInArrivo } from '@/lib/agenzia/servizi-scelti';

import { attivitaGiaIscritta, iscriviAttivita } from '@/lib/agenzia/nuova-attivita';
import { avviaDopoLIscrizione } from '@/lib/agenzia/dopo-iscrizione';
import { instagramDelTitolare, schedaGoogleDelTitolare } from '@/lib/agenzia/indizi-del-titolare';
import { confermaQuelloCheHaTrovatoLAd, instagramPerIlFlusso } from '@/lib/agenti/conferma-ad';
import { ABBONAMENTI, FASCE } from '@/lib/agenzia/preventivo';
import { sbloccaInContanti, sbloccoRiuscito, segnaLaSceltaSulPreventivo } from '@/lib/agenzia/abbonamento-contanti';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 28/11/2026, 01:10 e 01:25 — Nicola: il lavoro nasce dall'abbonamento «ma anche al servizio di cui ha bisogno, che
// lo selezionerà il venditore nel momento in cui seleziona l'abbonamento», fra «Foto e video, Gestione social e
// google, Gestione sitoweb, Analisi di mercato». Almeno un servizio, nessuno fuori elenco, e una nota facoltativa di
// 200 caratteri senza contatti (lib/agenzia/servizi-scelti.ts).
const Richiesta = z.object({
  lavoro: z.string().uuid('Codice del lavoro non valido.'),
  fascia: z.enum(ABBONAMENTI, { message: 'Scegli l’abbonamento che ha scelto il titolare.' }),
  // 28/11/2026 — Il sito trovato solo dal nome che il titolare ha confermato davanti all'agente («è il nostro»).
  sitoConfermato: z.string().trim().max(600).optional(),
}).and(ServiziInArrivo);

const stessoSito = (a: string, b: string) => {
  try { return new URL(a).hostname.replace(/^www\./, '').toLowerCase() === new URL(b).hostname.replace(/^www\./, '').toLowerCase(); } catch { return false; }
};

/** Un lavoro dopo la risposta. Fuori da una richiesta (le prove) `after` non c'è: si lancia e basta. */
const dopoLaRisposta = (fn: () => Promise<void>) => {
  try {
    after(fn);
  } catch {
    void fn();
  }
};

export const POST = conAgente({ name: 'agente-aggiungi', max: 20, windowMs: 60 * 60_000 }, async ({ req, email, profile }) => {
  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Richiesta non leggibile');
  }
  const esito = Richiesta.safeParse(corpo);
  if (!esito.success) return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Dati non validi');

  // 1. La scheda di quel lavoro, letta dal server, e solo se è dell'agente (o di Nicola).
  const r = await leggiLavoro(esito.data.lavoro);
  if (r.stato === 'sconosciuto') {
    // n8n giù o collegamento spento: non è «scheda non trovata», è «riprova» (collaudo del 27/11).
    if (r.errore && /non risponde|non acceso|ha risposto 5\d\d/.test(r.errore)) return ApiErrors.unavailable('Non riesco a leggere la scheda in questo momento. Riprova fra poco.');
    return ApiErrors.notFound(r.errore ?? 'Scheda non trovata.');
  }
  if (profile?.role !== 'admin' && r.venditore !== email) return ApiErrors.notFound('Scheda non trovata.');
  // Solo a scheda finita: prima il tipo e l'indirizzo dell'AD spesso mancano, e il negozio nascerebbe «negozio».
  if (r.stato === 'in_corso') return ApiErrors.conflict('La scheda non è ancora completa: aspetta che finisca, poi premi di nuovo.');
  const prima = normalizza(r.prima);
  if (!prima) return ApiErrors.unavailable('La scheda di questo lavoro non si legge.');
  let scheda = prima;
  if (r.stato === 'pronta') {
    const ad = pulisci(r.risultato);
    scheda = unisci(prima, ad, r.avvisi ?? []);
    if (!scheda.indirizzo && typeof ad.indirizzo === 'string' && ad.indirizzo.trim()) scheda = { ...scheda, indirizzo: ad.indirizzo.trim() };
    // 28/11/2026 — Il sito trovato dall'AD (o in una pagina che l'AD ha visto) si apre anche qui: prima arrivava al negozio solo
    // il sito aperto dal programma all'inizio, e all'accettazione il flusso 16 ripartiva «senza sito».
    scheda = await confermaQuelloCheHaTrovatoLAd(scheda, { sitoUrl: ad.sito?.url ?? null, pagine: ad.pagine ?? null });
  }
  // Il titolare ha confermato il sito trovato solo dal nome: vale come dato dal venditore, ma solo se è proprio quello
  // che la scheda ha trovato adesso (il browser non può far entrare un indirizzo suo).
  const conferma = esito.data.sitoConfermato;
  const m = scheda.sito.misura;
  if (conferma && m?.aperto && m.prova === 'nome' && stessoSito(conferma, m.url)) scheda = { ...scheda, sito: { ...scheda.sito, misura: { ...m, prova: 'venditore' } } };
  const attivita = attivitaDallaScheda(scheda);
  if (!attivita) return ApiErrors.invalidRequest(nomeNonValido(String(scheda.nome ?? '')) ?? 'I dati della scheda non bastano per aggiungere l’attività.');

  // 2. L'iscrizione, come il flusso 20. Un'attività è riconosciuta da nome e città: se ce n'è già una con
  // lo stesso nome ma un altro indirizzo, è un omonimo e non si fonde (collaudo: due «Bar Sport»).
  const admin = getAdminSupabase();
  const gia = await attivitaGiaIscritta(admin, attivita);
  if (gia && !stessoIndirizzo(gia.indirizzo, attivita.indirizzo)) {
    return ApiErrors.conflict(`Su MyCity c’è già un’attività «${attivita.nome}» con un altro indirizzo (${gia.indirizzo}). Per non mescolare due negozi diversi, scrivi a Nicola.`);
  }
  const fatto = await iscriviAttivita(admin, attivita);
  if (!fatto.ok) {
    if (fatto.motivo === 'gia-con-accesso') return ApiErrors.conflict('Questa attività ha già accettato il preventivo: è già su MyCity.');
    logger.error('[agente-aggiungi] iscrizione non riuscita', { dettaglio: fatto.dettaglio });
    return ApiErrors.unavailable('Non sono riuscito ad aggiungere l’attività. Riprova fra poco.');
  }
  const link = await linkDelPreventivo(admin, fatto.id);

  // 2-bis. L'abbonamento scelto: sul preventivo, e la pagina del negozio si sblocca in quella fascia.
  const fascia = esito.data.fascia;
  const segnata = await segnaLaSceltaSulPreventivo(admin, fatto.id, fascia);
  if (!segnata) logger.warn('[agente-aggiungi] scelta non scritta sul preventivo', { id: fatto.id, fascia });
  // 27/11/2026 — Chi l'ha portato (999c): la pagina dell'agente sa quando il titolare conferma, l'ordine di SDG dice l'agente.
  const portato = await segnaChiHaPortatoIlCliente(admin, fatto.id, { lavoro: esito.data.lavoro, agenteEmail: email });
  if (!portato) logger.warn('[agente-aggiungi] agente non scritto sul preventivo: controlla la migrazione 999c', { id: fatto.id });
  // 28/11/2026 — Quali servizi gli servono (999h): passano nell'ordine di SDG all'accettazione.
  const scelti = { servizi: esito.data.servizi, nota: esito.data.nota };
  const serviziSegnati = await segnaIServiziScelti(admin, fatto.id, scelti);
  if (!serviziSegnati) logger.warn('[agente-aggiungi] servizi scelti non scritti sul preventivo: controlla la migrazione 999h', { id: fatto.id });
  const sblocco = await sbloccaInContanti(admin, fatto.id, fascia);
  if (!sbloccoRiuscito(sblocco)) logger.error('[agente-aggiungi] pagina del negozio non sbloccata', { id: fatto.id, fascia, dettaglio: sblocco.dettaglio });
  logger.info('[agente-aggiungi] attività aggiunta', { id: fatto.id, nuova: fatto.nuova, conLink: Boolean(link), fascia, sblocco: sblocco.esito });

  // 3. Gli stessi passi del modulo 12, e l'avviso a Nicola (una volta per attività).
  // 28/11/2026 — Il profilo Instagram e il link della scheda Google vanno al flusso 16 come indizi, come quelli del modulo /sell.
  const instagram = instagramDelTitolare(instagramPerIlFlusso(scheda));
  const googleMaps = schedaGoogleDelTitolare(scheda.linkMaps);
  const indizi = { ...(instagram ? { instagram } : {}), ...(googleMaps ? { google_maps: googleMaps } : {}) };
  avviaDopoLIscrizione(admin, fatto, attivita, { dalModulo12: false, dopo: dopoLaRisposta, indizi });
  let avvisato = false;
  const nomeFascia = FASCE[fascia].nome;
  const fasciaCambiata = sblocco.esito === 'cambiata';
  // Collaudo del 27/11: anche su un'attività che c'era già (modulo 12, o fermata da Nicola per mancato
  // pagamento) una pagina che si sblocca adesso va detta a Nicola, sennò «se non paga, fermalo tu» si annulla.
  const sbloccataOra = sblocco.esito === 'sbloccata';
  const avvisoDovuto = fatto.nuova || fasciaCambiata || sbloccataOra;
  if (avvisoDovuto) {
    const pagina = sblocco.esito === 'gia-online'
      ? `Ha già un abbonamento ${FASCE[sblocco.fascia].nome} pagato online: quello resta.`
      : sbloccoRiuscito(sblocco)
        ? `La sua pagina è sbloccata col ${nomeFascia}, fino alla disdetta: i contanti si ritirano al primo servizio. Se non paga, fermalo tu.`
        : `ATTENZIONE: la sua pagina NON si è sbloccata col ${nomeFascia}: sistemalo a mano.`;
    avvisato = await notifyAdmins(
      fasciaCambiata
        ? `${attivita.nome}: l'abbonamento passa dal ${FASCE[sblocco.da].nome} al ${nomeFascia}`
        : fatto.nuova
          ? `${attivita.nome} ha detto sì col ${nomeFascia}: attività aggiunta dall'agente`
          : `${attivita.nome}: la pagina si è sbloccata di nuovo col ${nomeFascia}`,
      `L'agente ${email} ha premuto «Aggiungi attività» e ha scelto il ${nomeFascia}. Servizi scelti: ${scelti.servizi.map((x) => ETICHETTE_SERVIZI[x]).join(', ')}${scelti.nota ? ` (nota dell'agente: «${scelti.nota}»)` : ''}. ${pagina} Il negozio è su MyCity, nascosto e senza accesso finché il titolare non accetta il preventivo; il link lo trovi in Admin → Preventivi col link.`,
      '/admin/preventivi',
      // Una volta per attività alla nascita; ogni cambio di fascia e ogni nuovo sblocco ha il suo avviso.
      { unaVoltaPer: fatto.nuova ? `agente-aggiungi:${fatto.id}` : `agente-aggiungi:${fatto.id}:${sblocco.esito}:${fascia}:${new Date().toISOString()}` },
    ).then(() => true, (e: unknown) => {
      logger.warn('[agente-aggiungi] avviso a Nicola non partito', { id: fatto.id, errore: String(e) });
      return false;
    });
  }

  // 4. Il link da mandare al titolare.
  return NextResponse.json(
    { ok: true, data: { nome: attivita.nome, nuova: fatto.nuova, link, avvisato, avvisoDovuto, fascia, sbloccata: sbloccoRiuscito(sblocco), giaOnline: sblocco.esito === 'gia-online' } },
    { status: fatto.nuova ? 201 : 200, headers: { 'Cache-Control': 'no-store' } },
  );
});
