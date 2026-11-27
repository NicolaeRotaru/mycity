'use client';

// «ADESSO TOCCA A SDG» — la pagina dove arriva l'agente quando il titolare conferma l'abbonamento (27/11/2026).
//
// Nicola, 27/11 17:25: la pagina dell'agente «deve aggiornarsi e portarlo alla pagina con su scritto tutte le cose
// che deve fare adesso SDG». Qui l'agente legge cosa fa SDG da qui in poi per QUEL cliente, nella fascia scelta:
// la visita, le prime foto e video, il piano editoriale del primo mese, il sito, i contanti al primo servizio.
// Si riapre anche dopo, da «Hanno confermato» nella pagina dell'agente. I dati li dà /api/agente/attivita, che fa
// vedere a un agente solo le sue attività (all'admin tutte). La pagina sta sotto /agente: il layout fa entrare solo
// agenti attivi e l'admin.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import st from '@/components/agenti/scheda.module.css';
import sg from '@/components/agenti/tocca-a-sdg.module.css';
import type { AttivitaDopoIlSi } from '@/lib/agenti/attivita';

const NOMI_FASCE: Record<string, string> = { base: 'Base', business: 'Business', premium: 'Premium' };
const ALL_ACCESSO = `/sign-in?returnTo=${encodeURIComponent('/agente')}`;
const c = (nomi: string) => nomi.split(/\s+/).filter(Boolean).map((n) => sg[n] ?? st[n] ?? n).join(' ');
const giorno = (d: string | null) => (d ? new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', timeZone: 'Europe/Rome' }) : null);

type Stato = { fase: 'leggo' } | { fase: 'attendo' } | { fase: 'errore'; messaggio: string } | { fase: 'pronta'; a: AttivitaDopoIlSi };
const ATTESA_ORDINE_MS = 3000;
const ATTESA_ORDINE_TENTATIVI = 10;

export default function AdessoToccaASdg() {
  const [stato, setStato] = useState<Stato>({ fase: 'leggo' });

  useEffect(() => {
    const lavoro = new URLSearchParams(location.search).get('lavoro') ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(lavoro)) { setStato({ fase: 'errore', messaggio: 'Manca il codice della scheda: riapri l’attività dalla pagina dell’agente.' }); return; }
    let spento = false;
    let tentativi = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const leggiOra = async () => {
      try {
        const r = await fetch(`/api/agente/attivita?lavoro=${encodeURIComponent(lavoro)}`, { cache: 'no-store' });
        if (spento) return;
        if (r.status === 401) { location.href = ALL_ACCESSO; return; }
        const d = (await r.json().catch(() => null)) as { ok?: boolean; data?: AttivitaDopoIlSi; error?: { message?: string } } | null;
        if (spento) return;
        if (!r.ok || !d?.data) { setStato({ fase: 'errore', messaggio: d?.error?.message ?? 'Questa attività non si trova.' }); return; }
        // Il titolare ha appena confermato e l'ordine di SDG nasce qualche istante dopo (collaudo del 27/11):
        // si richiede ogni 3 secondi, per mezzo minuto, prima di dire che l'ordine non si legge.
        if (d.data.stato === 'accettato' && !d.data.ordine && tentativi < ATTESA_ORDINE_TENTATIVI) {
          tentativi += 1;
          setStato({ fase: 'attendo' });
          timer = setTimeout(leggiOra, ATTESA_ORDINE_MS);
          return;
        }
        setStato({ fase: 'pronta', a: d.data });
      } catch {
        if (!spento) setStato({ fase: 'errore', messaggio: 'Niente rete, o il sito non risponde. Riprova fra un attimo.' });
      }
    };
    void leggiOra();
    return () => { spento = true; if (timer) clearTimeout(timer); };
  }, []);

  return (
    <div className={c('radice')}>
      <div className={c('pagina')}>
        <div className={c('testata')}>
          <div className={c('barraAlta')}>
            <span className={c('marchio')}><b>MyCity</b> · Agenti</span>
          </div>
          <h1>Adesso tocca a SDG</h1>
        </div>

        {stato.fase === 'leggo' && <p className={c('nota')} role="status">Leggo l’attività…</p>}
        {stato.fase === 'attendo' && <p className={c('nota')} role="status">Il titolare ha appena confermato: aspetto che l’ordine arrivi a SDG…</p>}
        {stato.fase === 'errore' && <p className={c('errore')} role="alert">{stato.messaggio}</p>}
        {stato.fase === 'pronta' && <Contenuto a={stato.a} />}

        <Link className={c('torna')} href="/agente">← Torna alle tue schede</Link>
      </div>
    </div>
  );
}

function Contenuto({ a }: { a: AttivitaDopoIlSi }) {
  const fascia = a.fascia ? NOMI_FASCE[a.fascia] : null;
  if (a.stato === 'aperto') {
    return (
      <section className={c('riquadro')} role="status">
        <h2>{a.nome} non ha ancora confermato</h2>
        <p>Quando il titolare conferma l’abbonamento dal link, qui trovi tutto quello che fa SDG da lì in poi.</p>
        {a.link && <p className={c('nota')}>Il link da mandargli: <span className={c('link')}>{a.link}</span></p>}
      </section>
    );
  }
  if (a.stato === 'chiuso') {
    return (
      <section className={c('riquadro')} role="status">
        <h2>Il preventivo di {a.nome} è chiuso</h2>
        <p>Non vale più: scrivi a Nicola se il titolare vuole ripartire.</p>
      </section>
    );
  }
  return (
    <>
      <p className={c('nota')}>
        <b>{a.nome}</b> ha confermato l’abbonamento{fascia ? ` ${fascia}` : ''}{a.accettatoIl ? ` il ${giorno(a.accettatoIl)}` : ''}. Da qui in poi lavora SDG: ecco cosa succede, nell’ordine.
      </p>
      <section className={c('riquadro visita')} aria-label="La visita">
        <p>{a.visita}</p>
      </section>
      <ol className={c('passi')}>
        {a.passi.map((p) => (
          <li key={p.titolo} className={c('passo')}>
            <h2>{p.titolo}</h2>
            <p>{p.testo}</p>
            {p.perLui && <p className={c('perLui nota')}>Per {a.nome}: {p.perLui}</p>}
          </li>
        ))}
      </ol>
      {a.ordine && (
        <p className={c('nota')}>
          L’ordine è arrivato a SDG col piano del primo mese{a.ordine.periodo ? ` (${a.ordine.periodo})` : ''}: {a.ordine.contenuti} contenuti, {a.ordine.pianoOrigine === 'ad' ? 'versione completa dell’AD' : 'prima versione del sito'}.
        </p>
      )}
      <section className={c('riquadro')}>
        <h2>E tu?</h2>
        <p>Non devi fare altro. Se il titolare ti chiede cosa succede adesso, la risposta è in questa pagina.</p>
      </section>
    </>
  );
}
