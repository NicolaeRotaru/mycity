'use client';

import { useEffect, useState } from 'react';
import st from '@/components/agenti/scheda.module.css';
import ag from '@/components/agenti/aggiungi.module.css';
import { FASCE, ID_FASCE, euro, type IdFascia } from '@/lib/agenti/fasce';

/**
 * IL PULSANTE «AGGIUNGI ATTIVITÀ» SOTTO LA SCHEDA — 27/11/2026.
 *
 * Nicola: il preventivo nasce solo quando il titolare dice «sì, voglio aderire», «con un clic dalla stessa
 * pagina». L'agente preme, conferma che il titolare ha detto sì, e il sito iscrive l'attività su MyCity
 * (nascosta, senza accesso) e gli dà il link del preventivo da mandare al titolare (app/api/agente/aggiungi).
 * Il sito non manda niente da solo. Per ora si paga in contanti.
 *
 * 27/11/2026 02:26 — Nicola: «in questo punto bisogna selezionare di che abbonamento ha scelto l'imprenditore»,
 * e «in automatico deve sbloccarsi la pagina del venditore in base all'abbonamento». L'agente sceglie Base,
 * Business o Premium; «Sì, aggiungi» si accende solo dopo la scelta. Nessuna fascia è scelta in partenza:
 * deve essere quella detta dal titolare, non quella consigliata.
 *
 * 27/11/2026 17:25 — Nicola: quando il titolare conferma l'abbonamento dal link, questa pagina «deve aggiornarsi e
 * portarlo alla pagina con su scritto tutte le cose che deve fare adesso SDG». Dopo il «Sì» il riquadro chiede da
 * solo ogni 10 secondi a che punto è il preventivo (app/api/agente/attivita), solo con la scheda visibile, e smette
 * dopo 30 minuti; appena è «accettato» porta l'agente a «Adesso tocca a SDG» (app/agente/tocca-a-sdg).
 */
type Fase = 'pronto' | 'conferma' | 'invio' | 'fatto' | 'errore';
type Attesa = 'controllo' | 'confermato' | 'chiuso' | 'smesso';

/** Ogni quanto si chiede se il titolare ha confermato, e dopo quanto si smette. */
export const CONTROLLA_OGNI_MS = 10_000;
export const SMETTI_DOPO_MS = 30 * 60_000;
export const paginaDiSdg = (lavoro: string) => `/agente/tocca-a-sdg?lavoro=${encodeURIComponent(lavoro)}`;

const c = (nomi: string) => nomi.split(/\s+/).filter(Boolean).map((n) => ag[n] ?? st[n] ?? n).join(' ');

export default function AggiungiAttivita({ lavoro, nome, consigliato = null, vai }: { lavoro: string; nome: string; consigliato?: IdFascia | null; vai?: (indirizzo: string) => void }) {
  const [fase, setFase] = useState<Fase>('pronto');
  const [attesa, setAttesa] = useState<Attesa>('controllo');
  const [fascia, setFascia] = useState<IdFascia | null>(null);
  const [sbloccata, setSbloccata] = useState(false);
  const [giaOnline, setGiaOnline] = useState(false);
  const [avvisoDovuto, setAvvisoDovuto] = useState(true);
  const [link, setLink] = useState<string | null>(null);
  const [gia, setGia] = useState(false);
  const [avvisato, setAvvisato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [copiato, setCopiato] = useState(false);

  async function aggiungi() {
    if (!fascia) return;
    setFase('invio');
    setErrore(null);
    try {
      const r = await fetch('/api/agente/aggiungi', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lavoro, fascia }) });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; data?: { link?: string | null; nuova?: boolean; avvisato?: boolean; avvisoDovuto?: boolean; sbloccata?: boolean; giaOnline?: boolean }; error?: { message?: string } } | null;
      if (!r.ok || !d?.ok) {
        setErrore(d?.error?.message ?? 'Non sono riuscito ad aggiungere l’attività. Riprova fra poco.');
        setFase('errore');
        return;
      }
      setLink(d.data?.link ?? null);
      setGia(d.data?.nuova === false);
      setAvvisato(d.data?.avvisato === true);
      setSbloccata(d.data?.sbloccata === true);
      setGiaOnline(d.data?.giaOnline === true);
      setAvvisoDovuto(d.data?.avvisoDovuto ?? d.data?.nuova !== false);
      setFase('fatto');
    } catch {
      setErrore('Non sono riuscito ad aggiungere l’attività. Controlla la connessione e riprova.');
      setFase('errore');
    }
  }

  // Dopo il «Sì»: il titolare ha confermato? Si chiede solo con la scheda visibile, e per 30 minuti al massimo.
  useEffect(() => {
    if (fase !== 'fatto') return;
    let spento = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nonTrovate = 0;
    const inizio = Date.now();
    const giro = async () => {
      if (spento) return;
      if (Date.now() - inizio >= SMETTI_DOPO_MS) { setAttesa('smesso'); return; }
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        try {
          const r = await fetch(`/api/agente/attivita?lavoro=${encodeURIComponent(lavoro)}`, { cache: 'no-store' });
          const d = (await r.json().catch(() => null)) as { ok?: boolean; data?: { stato?: string } } | null;
          if (spento) return;
          if (r.ok && d?.data?.stato === 'accettato') {
            setAttesa('confermato');
            (vai ?? ((u: string) => window.location.assign(u)))(paginaDiSdg(lavoro));
            return;
          }
          if (r.ok && d?.data?.stato === 'chiuso') { setAttesa('chiuso'); return; }
          // Un'attività che non c'è (o non è più sua) non diventerà mai confermata: tre risposte così e ci si ferma.
          if (r.status === 404 && ++nonTrovate >= 3) { setAttesa('smesso'); return; }
        } catch { /* rete ballerina: si riprova al prossimo giro */ }
      }
      timer = setTimeout(giro, CONTROLLA_OGNI_MS);
    };
    timer = setTimeout(giro, CONTROLLA_OGNI_MS);
    return () => { spento = true; if (timer) clearTimeout(timer); };
  }, [fase, lavoro, vai]);

  async function copia() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiato(true);
    } catch {
      setCopiato(false);
    }
  }

  if (fase === 'fatto') {
    const nomeFascia = fascia ? FASCE[fascia].nome : '';
    return (
      <section className={c('riquadro fatto')} role="status" aria-live="polite">
        <h2>{gia ? `${nome} era già su MyCity` : `${nome} è su MyCity`}</h2>
        {giaOnline
          ? <p>Ha già un abbonamento pagato online: resta quello.</p>
          : sbloccata
            ? <p>La sua pagina è sbloccata col {nomeFascia}, fino alla disdetta. Sul marketplace la sua vetrina si vede solo dopo l’approvazione di Nicola.</p>
            : <p className={c('errore')}>La sua pagina non si è sbloccata col {nomeFascia}: dillo a Nicola.</p>}
        <p>Il titolare entra nella sua pagina appena conferma l’abbonamento dal link.{avvisato ? ' Nicola ha ricevuto l’avviso.' : ''}</p>
        {avvisoDovuto && !avvisato && <p className={c('errore')}>L’avviso a Nicola non è partito: diglielo tu.</p>}
        {link ? (
          <>
            <p className={c('nota')}>Manda questo link al titolare: vede i tre abbonamenti {nomeFascia ? `col ${nomeFascia}` : 'con la sua scelta'} già segnato, preme «Confermo» ed entra.</p>
            <p className={c('link')}>{link}</p>
            <button type="button" className={c('bottone')} onClick={copia}>{copiato ? 'Copiato' : 'Copia il link'}</button>
          </>
        ) : (
          <p className={c('errore')}>Il link del preventivo non si legge da qui: lo trovi in Admin → Preventivi col link.</p>
        )}
        <p className={c('nota')}>Per ora l’abbonamento si paga in contanti, di persona, al primo servizio.</p>
        {attesa === 'controllo' && <p className={c('nota')}>Controllo da solo, ogni 10 secondi, se il titolare ha confermato: appena conferma ti porto alla pagina «Adesso tocca a SDG».</p>}
        {attesa === 'confermato' && <p>Il titolare ha confermato. <a href={paginaDiSdg(lavoro)}>Adesso tocca a SDG →</a></p>}
        {attesa === 'chiuso' && <p className={c('errore')}>Questo preventivo è stato chiuso: scrivi a Nicola.</p>}
        {attesa === 'smesso' && <p className={c('nota')}>Ho smesso di controllare. Quando il titolare conferma, ricarica la pagina: la trovi fra «Hanno confermato».</p>}
      </section>
    );
  }

  if (fase === 'conferma' || fase === 'invio') {
    return (
      <section className={c('riquadro')} aria-labelledby="conferma-aggiungi">
        <h2 id="conferma-aggiungi">Il titolare di {nome} ha detto sì?</h2>
        <p>Il sito aggiunge l’attività su MyCity, nascosta, crea il suo preventivo e sblocca la sua pagina con l’abbonamento che ha scelto. Ti do il link da mandargli.</p>
        <fieldset className={c('fasce')} disabled={fase === 'invio'}>
          <legend>Che abbonamento ha scelto?</legend>
          {ID_FASCE.map((id) => (
            <label key={id} className={c(fascia === id ? 'fascia scelta' : 'fascia')}>
              <input type="radio" name={`fascia-${lavoro}`} value={id} checked={fascia === id} onChange={() => setFascia(id)} />
              <span><b>{FASCE[id].nome}</b>{id === consigliato ? <span className={c('nota')}> · consigliato</span> : null}</span>
              <span className={c('nota')}>{euro(FASCE[id].centesimi)} al mese</span>
            </label>
          ))}
        </fieldset>
        {!fascia && <p className={c('nota')}>Scegli l’abbonamento per andare avanti.</p>}
        <div className={c('azioni')}>
          <button type="button" className={c('bottone')} onClick={aggiungi} disabled={fase === 'invio' || !fascia}>{fase === 'invio' ? 'Aggiungo…' : 'Sì, aggiungi'}</button>
          <button type="button" className={c('bottone secondario')} onClick={() => setFase('pronto')} disabled={fase === 'invio'}>Non ancora</button>
        </div>
      </section>
    );
  }

  return (
    <section className={c('riquadro')}>
      <p className={c('nota')}>Il titolare vuole aderire? Aggiungi l’attività: nasce il preventivo da mandargli.</p>
      {errore && <p className={c('errore')} role="alert">{errore}</p>}
      <button type="button" className={c('bottone')} onClick={() => setFase('conferma')}>Aggiungi attività</button>
    </section>
  );
}
