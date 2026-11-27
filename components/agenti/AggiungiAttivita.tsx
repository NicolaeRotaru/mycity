'use client';

import { useState } from 'react';
import st from '@/components/agenti/scheda.module.css';
import ag from '@/components/agenti/aggiungi.module.css';

/**
 * IL PULSANTE «AGGIUNGI ATTIVITÀ» SOTTO LA SCHEDA — 27/11/2026.
 *
 * Nicola: il preventivo nasce solo quando il titolare dice «sì, voglio aderire», «con un clic dalla stessa
 * pagina». L'agente preme, conferma che il titolare ha detto sì, e il sito iscrive l'attività su MyCity
 * (nascosta, senza accesso) e gli dà il link del preventivo da mandare al titolare (app/api/agente/aggiungi).
 * Il sito non manda niente da solo. Per ora si paga in contanti.
 */
type Fase = 'pronto' | 'conferma' | 'invio' | 'fatto' | 'errore';

const c = (nomi: string) => nomi.split(/\s+/).filter(Boolean).map((n) => ag[n] ?? st[n] ?? n).join(' ');

export default function AggiungiAttivita({ lavoro, nome }: { lavoro: string; nome: string }) {
  const [fase, setFase] = useState<Fase>('pronto');
  const [link, setLink] = useState<string | null>(null);
  const [gia, setGia] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [copiato, setCopiato] = useState(false);

  async function aggiungi() {
    setFase('invio');
    setErrore(null);
    try {
      const r = await fetch('/api/agente/aggiungi', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lavoro }) });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; data?: { link?: string | null; nuova?: boolean }; error?: { message?: string } } | null;
      if (!r.ok || !d?.ok) {
        setErrore(d?.error?.message ?? 'Non sono riuscito ad aggiungere l’attività. Riprova fra poco.');
        setFase('errore');
        return;
      }
      setLink(d.data?.link ?? null);
      setGia(d.data?.nuova === false);
      setFase('fatto');
    } catch {
      setErrore('Non sono riuscito ad aggiungere l’attività. Controlla la connessione e riprova.');
      setFase('errore');
    }
  }

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
    return (
      <section className={c('riquadro fatto')} role="status" aria-live="polite">
        <h2>{gia ? `${nome} era già su MyCity` : `${nome} è su MyCity`}</h2>
        <p>È nascosta e senza accesso finché il titolare non accetta il preventivo. Nicola ha ricevuto l’avviso.</p>
        {link ? (
          <>
            <p className={c('nota')}>Manda questo link al titolare: apre il suo preventivo e preme «Accetto il preventivo».</p>
            <p className={c('link')}>{link}</p>
            <button type="button" className={c('bottone')} onClick={copia}>{copiato ? 'Copiato' : 'Copia il link'}</button>
          </>
        ) : (
          <p className={c('errore')}>Il link del preventivo non si legge da qui: lo trovi in Admin → Preventivi col link.</p>
        )}
        <p className={c('nota')}>Per ora l’abbonamento si paga in contanti, di persona.</p>
      </section>
    );
  }

  if (fase === 'conferma' || fase === 'invio') {
    return (
      <section className={c('riquadro')} aria-labelledby="conferma-aggiungi">
        <h2 id="conferma-aggiungi">Il titolare di {nome} ha detto sì?</h2>
        <p>Il sito aggiunge l’attività su MyCity, nascosta, e crea il suo preventivo. Ti do il link da mandargli.</p>
        <div className={c('azioni')}>
          <button type="button" className={c('bottone')} onClick={aggiungi} disabled={fase === 'invio'}>{fase === 'invio' ? 'Aggiungo…' : 'Sì, aggiungi'}</button>
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
