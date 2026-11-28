'use client';

// La scheda a schermo: le stesse sezioni di scheda.html (cervello/scheda-cliente.mjs → paginaScheda),
// in un ordine pensato per chi la legge in strada: prima cosa dire e cosa offrire, poi i dati e le fonti.
// Finché l'AD non ha finito, le sezioni sue mostrano «sta scrivendo»; quelle del programma sono già piene.
//
// 26/11/2026 — Nicola: «crea le 3 schede dell'abbonamento in cui inserisci i benefici in base all'abbonamento,
// e siccome la pagina diventa troppo lunga, dividile in più pagine dentro un menù a tendina», «senza togliere
// nulla di quello che c'è». Le sezioni sono tutte quelle di prima, nello stesso ordine, divise in PAGINE; la
// testata e il piede restano sempre in vista. La pagina nuova è «I tre abbonamenti» (`TreAbbonamenti`).
// Poco dopo: «dentro ogni abbonamento deve esserci la personalizzazione esatta del servizio che offriamo al
// cliente»: sotto ogni servizio c'è la riga «Per <negozio>» (lib/agenti/su-misura.ts: dall'AD, o dal programma).
//
// 27/11/2026 — Nicola: «inserisci cosa possiamo offrire e perché dentro la scheda cosa ha e non ha», «elimina le 3
// schede abbonamento». La sezione «Cosa possiamo offrire, e perché» sta ora nella prima pagina, sotto «Cosa ha, cosa
// non ha»: la pagina «Cosa offrire» non c'è più. Tolti i tre riquadri riassuntivi Base/Business/Premium che stavano
// sotto le offerte; il bottone porta sempre alla pagina «I tre abbonamenti», che resta com'era.
// Subito dopo: «migliora il menu, in questo modo è scomodo». La tendina tagliava il titolo («Reputazione,
// concorrenti e…») e chiedeva due tocchi per cambiare parte: ora le parti sono sei bottoni corti, tutti in vista,
// e quella aperta è piena. Il titolo lungo resta nei bottoni «Avanti» e «indietro» in fondo alla pagina.

import { useRef, useState } from 'react';
import { canonePrimoMese } from '@/lib/agenzia/preventivo';
import { CONDIZIONI, FASCE, ID_FASCE, PAGAMENTO, euro } from '@/lib/agenti/fasce';
import { STATI, type Scheda as TScheda } from '@/lib/agenti/scheda';
import { percheSuMisura, rigaSuMisura } from '@/lib/agenti/su-misura';
import GoogleInDiretta from './GoogleInDiretta';
import { schedaGoogleCollegata } from '@/components/seller/SchedaGoogleUfficiale';
import st from './scheda.module.css';

/** Le classi della scheda vivono in un modulo CSS: non toccano il resto di MyCity. */
const c = (nomi: string) => nomi.split(/\s+/).filter(Boolean).map((n) => st[n] ?? n).join(' ');
const dominio = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function Fonte({ url }: { url: string | null }) {
  if (url && /^https?:\/\//.test(url)) return <a className={c('fonte')} href={url} target="_blank" rel="noopener noreferrer">{dominio(url)}</a>;
  return <span className={c('fonte nessuna')}>nessuna fonte</span>;
}

function Scrive({ righe = 3 }: { righe?: number }) {
  return (
    <div className={c('scrive')} aria-label="L’AD sta scrivendo questa parte">
      {Array.from({ length: righe }, (_, i) => <i key={i} style={{ width: `${92 - i * 14}%` }} />)}
    </div>
  );
}

function Lista({ voci, attesa, righe }: { voci: string[]; attesa: boolean; righe?: number }) {
  if (!voci.length) return attesa ? <Scrive righe={righe} /> : <p className={c('vuoto')}>Niente da dire, per ora.</p>;
  return <ul>{voci.map((v, i) => <li key={i}>{v}</li>)}</ul>;
}

/** Le pagine della scheda, nell'ordine di lettura: il menu (col nome corto) e «Avanti» (col titolo) le seguono così. */
export const PAGINE = [
  { id: 'breve', corto: 'In breve', titolo: 'In breve: cosa ha e cosa non ha' },
  { id: 'abbonamenti', corto: 'Abbonamenti', titolo: 'I tre abbonamenti' },
  { id: 'domande', corto: 'Domande', titolo: 'Domande e obiezioni' },
  { id: 'online', corto: 'Sito e social', titolo: 'Sito e social' },
  { id: 'reputazione', corto: 'Reputazione', titolo: 'Reputazione, concorrenti e potenziale' },
  { id: 'dati', corto: 'Dati e fonti', titolo: 'Dati e fonti' },
] as const;
export type IdPagina = (typeof PAGINE)[number]['id'];

/** Le tre schede degli abbonamenti: i benefici di ognuno dal listino del sito, e sotto ogni servizio cosa faremo per questo negozio. */
function TreAbbonamenti({ s }: { s: TScheda }) {
  const { consigliato, perche_consigliato: perche } = s;
  const attesa = !s.completa;
  return (
    <section className={c('sezione')} aria-labelledby="tre-abbonamenti"><h2 id="tre-abbonamenti">I tre abbonamenti</h2>
      <p className={c('nota')}>Ognuno comprende tutti i servizi: cambia quanto. Sotto ogni servizio, in evidenza, c’è cosa faremo per {s.nome} con quell’abbonamento: è la parte da vendere.</p>
      {attesa && <p className={c('nota')} role="status">Le righe «Per {s.nome}» le sta completando l’AD con quello che trova: intanto le prime le ha scritte il programma coi dati già letti.</p>}
      <div className={c('abbonamenti')}>
        {ID_FASCE.map((id) => {
          const fa = FASCE[id];
          const scelto = id === consigliato;
          const guadagno = percheSuMisura(s, id);
          return (
            <div key={id} data-fascia={id} role="group" className={c(`abbonamento${scelto ? ' scelta' : ''}`)} aria-label={`Abbonamento ${fa.nome}${scelto ? ', consigliato' : ''}`}>
              <div className={c('capo')}>
                <h3>{fa.nome}</h3>
                {scelto && <span className={c('chip forte')}>Consigliato dall’AD</span>}
              </div>
              <p className={c('prezzo')}><b>{euro(fa.centesimi)}</b> <span className={c('nota')}>al mese</span></p>
              <p className={c('nota')}>Il primo mese {euro(canonePrimoMese(fa.centesimi) ?? fa.centesimi)}</p>
              <p>{fa.perChi}</p>
              {guadagno && <p className={c('guadagno')} data-su-misura="perche"><b>Cosa ci guadagna {s.nome}:</b> {guadagno}</p>}
              <div className={c('misure')}>
                <div className={c('misura')}><b>{fa.post}</b><span className={c('nota')}>contenuti al mese</span></div>
                <div className={c('misura')}><b>{fa.video}</b><span className={c('nota')}>video al mese</span></div>
              </div>
              <ul className={c('benefici')} aria-label={`Cosa comprende il ${fa.nome}`}>
                {fa.benefici.map((b) => {
                  const riga = b.servizio ? rigaSuMisura(s, id, b.servizio) : null;
                  return (
                    <li key={b.voce} data-voce={b.voce}><span className={c('spunta')} aria-hidden="true">✓</span>
                      <span className={c('beneficio')}>
                        <span>{b.testo.startsWith(b.voce) ? <><b>{b.voce}</b>{b.testo.slice(b.voce.length)}</> : <><b>{b.voce}.</b> {b.testo}</>}</span>
                        {riga && <span className={c('suMisura')} data-su-misura={riga.daChi}><b>Per {s.nome}:</b> {riga.testo}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {scelto && perche && <p className={c('perche')}><b>Perché l’AD lo consiglia:</b> {perche}</p>}
            </div>
          );
        })}
      </div>
      <p className={c('nota')}>{CONDIZIONI}</p>
      <p className={c('nota')}>{PAGAMENTO}</p>
    </section>
  );
}

export default function Scheda({ s }: { s: TScheda }) {
  const attesa = !s.completa;
  const f = s.consigliato ? FASCE[s.consigliato] : null;
  const m = s.sito.misura;
  const [pagina, setPagina] = useState<IdPagina>('breve');
  const menu = useRef<HTMLElement>(null);
  const qui = PAGINE.findIndex((p) => p.id === pagina);
  const prima = qui > 0 ? PAGINE[qui - 1] : null;
  const dopo = qui < PAGINE.length - 1 ? PAGINE[qui + 1] : null;
  // Cambiando pagina si torna al menu: chi ha letto fino in fondo e preme «Avanti» vede l'inizio della pagina nuova.
  const vai = (id: IdPagina, sali = false) => {
    setPagina(id);
    if (sali) {
      menu.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      // Il bottone premuto può sparire (l'ultima pagina non ha «Avanti»): il fuoco va sulla voce del menu, non si perde.
      menu.current?.querySelector<HTMLButtonElement>(`[data-pagina="${id}"]`)?.focus({ preventScroll: true });
    }
  };
  return (
    <article className={c('pagina')} aria-busy={attesa}>
      <header className={c('testata')}>
        <p className={c('interno')}>Scheda interna per il venditore: non si mostra e non si manda al titolare.</p>
        <span className={c('occhiello')}>Scheda cliente · {s.data}</span>
        <h1>{s.nome}</h1>
        <p>{[s.tipo, s.indirizzo ?? s.citta].filter(Boolean).join(' · ')}</p>
        <div className={c('chips')}>
          {f ? <><span className={c('chip forte')}>Consigliato: {f.nome} · {euro(f.centesimi)} al mese</span><span className={c('chip')}>Primo mese {euro(f.centesimi / 2)}</span></>
            : <span className={c('chip')}>{attesa ? 'L’abbonamento lo sceglie l’AD fra pochi secondi' : 'L’AD non ha scelto l’abbonamento: guarda le fasce in «I tre abbonamenti»'}</span>}
          {s.linkMaps && <a className={c('chip')} href={s.linkMaps} target="_blank" rel="noopener noreferrer">Apri la scheda Google ↗</a>}
        </div>
      </header>

      <nav className={c('menuPagine')} ref={menu} aria-label="Parti della scheda">
        <span className={c('occhiello')}>Parte della scheda · {qui + 1} di {PAGINE.length}</span>
        <div className={c('vociMenu')}>
          {PAGINE.map((p) => {
            const aperta = p.id === pagina;
            return <button key={p.id} type="button" data-pagina={p.id} aria-current={aperta ? 'page' : undefined} title={p.titolo}
              className={c(`voceMenu${aperta ? ' aperta' : ''}`)} onClick={() => vai(p.id)}>{p.corto}</button>;
          })}
        </div>
      </nav>

      {pagina === 'breve' && <>
      <section className={c('trenta')} aria-labelledby="t30">
        <span className={c('occhiello')} id="t30">In 30 secondi, prima di entrare</span>
        {s.in_30_secondi.length ? <ul>{s.in_30_secondi.map((v, i) => <li key={i}>{v}</li>)}</ul> : attesa ? <Scrive righe={4} /> : <p>L’AD non ha scritto il riassunto: leggi «Ha già» e «Non ha» qui sotto.</p>}
        {s.gancio ? <p><b>Il gancio per aprire:</b> {s.gancio}</p> : attesa ? null : null}
      </section>

      {/* 28/11: chiuso, spostato, voto e orari li sa solo Google: riquadro ufficiale in diretta, spento senza chiave. */}
      {schedaGoogleCollegata() && <div className={c('sezione')}><GoogleInDiretta nome={s.nome} indirizzo={s.indirizzo} citta={s.citta} /></div>}

      <section className={c('sezione')}><h2>Cosa ha, cosa non ha, cosa va migliorato</h2>
        <div className={c('colonne')}>
          <div className={c('riquadro ha')}><h3><span className={c('pallino')} />Ha già</h3><Lista voci={s.ha} attesa={attesa} /></div>
          <div className={c('riquadro nonha')}><h3><span className={c('pallino')} />Non ha</h3><Lista voci={s.non_ha} attesa={attesa} /></div>
          <div className={c('riquadro migliora')}><h3><span className={c('pallino')} />Da migliorare</h3><Lista voci={s.migliorare} attesa={attesa} /></div>
        </div>
      </section>

      <section className={c('sezione')}><h2>Cosa possiamo offrire, e perché</h2>
        {s.offerta.length ? <div className={c('griglia')}>{s.offerta.map((o, i) => <div className={c('riquadro')} key={i}><h3>{o.servizio}</h3><p>{o.perche}</p></div>)}</div>
          : attesa ? <div className={c('riquadro')}><Scrive /></div> : <p className={c('vuoto')}>L’AD non ha scritto le offerte.</p>}
        {s.perche_consigliato && <p className={c('nota')}><b>Perché il {f?.nome ?? 'consigliato'}:</b> {s.perche_consigliato}</p>}
        <p className={c('nota')}>Primo mese a metà, nessun vincolo, disdetta con 30 giorni di preavviso. Sui prodotti venduti tramite MyCity resta il 10%; al banco niente. Oggi si paga in contanti, di persona.</p>
        <button type="button" className={c('bottone secondario')} onClick={() => vai('abbonamenti', true)}>Apri le tre schede degli abbonamenti</button>
      </section>
      </>}

      {pagina === 'abbonamenti' && <TreAbbonamenti s={s} />}

      {pagina === 'domande' && <>

      <section className={c('sezione')}><h2>Domande da fare al titolare</h2><div className={c('riquadro')}><Lista voci={s.domande} attesa={attesa} righe={4} /></div></section>

      <section className={c('sezione')}><h2>Obiezioni probabili</h2>
        <div className={c('griglia')}>{s.obiezioni.map((o, i) => <div className={c('riquadro')} key={i}><p><b>«{o.obiezione}»</b></p><p>{o.risposta}</p></div>)}</div>
        {attesa && <p className={c('nota')}>Quelle tipiche di questo negozio le aggiunge l’AD.</p>}
      </section>

      <section className={c('sezione')}><h2>Attenzione</h2><div className={c('riquadro')}><Lista voci={s.attenzione} attesa={false} /></div></section>
      </>}

      {pagina === 'online' && <>

      <section className={c('sezione')}><h2>Sito e social di oggi</h2>
        <div className={c('riquadro')}>
          <h3>Sito · livello «{s.sito.livello}»{s.sito.daChi === 'programma' ? ' (stima del programma)' : ''}</h3>
          {m?.aperto && (
            <div className={c('misure')}>
              <div className={c('misura')}><b>{m.pagine}</b><span className={c('nota')}>{m.pagine === 1 ? 'pagina' : 'pagine'} dalla home</span></div>
              <div className={c('misura')}><b>{m.https === false ? 'No' : m.https ? 'Sì' : '—'}</b><span className={c('nota')}>protetto (https)</span></div>
              <div className={c('misura')}><b>{m.telefonino ? 'Sì' : 'No'}</b><span className={c('nota')}>pensato per il telefono</span></div>
              {m.anno && <div className={c('misura')}><b>{m.anno}</b><span className={c('nota')}>anno in fondo alla pagina</span></div>}
              {m.piattaforma && <div className={c('misura')}><b>{m.piattaforma}</b><span className={c('nota')}>fatto con</span></div>}
            </div>
          )}
          {s.sito.giudizio ? <p>{s.sito.giudizio}</p> : attesa ? <Scrive righe={2} /> : !m?.aperto ? <p className={c('vuoto')}>Sito non visto: per la tabella firmata vale «medio». Guardalo dal telefono.</p> : null}
          {s.sito.fonte && <p className={c('nota')}>Fonte: <Fonte url={s.sito.fonte} /></p>}
        </div>
        <div className={c('tabella')}><table className={c('pila')}><thead><tr><th>Canale</th><th>Livello</th><th>Cosa si vede</th><th>Fonte</th></tr></thead>
          <tbody>{s.social.map((p, i) => (
            <tr key={i}><td>{p.canale}</td><td><span className={c(`stato ${p.stato === 'non_trovato' ? 'non_trovato' : 'da_confermare'}`)}>{p.livello ?? (p.stato === 'trovato' ? 'Trovato' : 'Non trovato')}</span></td><td>{p.giudizio ?? ''}</td><td><Fonte url={p.fonte} /></td></tr>
          ))}
          {attesa && <tr><td colSpan={4}><span className={c('nota')}>Instagram, Facebook e TikTok li sta cercando l’AD…</span></td></tr>}</tbody></table></div>
      </section>
      </>}

      {pagina === 'reputazione' && <>

      <section className={c('sezione')}><h2>Reputazione</h2>
        <div className={c('riquadro')}>{s.reputazione.sintesi ? <p>{s.reputazione.sintesi}</p> : attesa ? <Scrive righe={2} /> : <p className={c('vuoto')}>Nessuna recensione trovata fuori da Google: guardale sulla scheda Google.</p>}</div>
        <div className={c('colonne')}>
          <div className={c('riquadro')}><h3>Cosa piace</h3><Lista voci={s.reputazione.positivi} attesa={attesa} righe={2} /></div>
          <div className={c('riquadro')}><h3>Cosa non piace</h3><Lista voci={s.reputazione.negativi} attesa={attesa} righe={2} /></div>
        </div>
      </section>

      <section className={c('sezione')}><h2>Concorrenti vicini</h2>
        <div className={c('riquadro')}>
          {s.concorrenti.length ? <>
            <p>{s.concorrentiContati} dello stesso tipo nel raggio di 450 metri, sulla mappa libera. I più vicini:</p>
            <ul>{s.concorrenti.map((x, i) => <li key={i}>{x.nome}{x.tipo ? ` · ${x.tipo}` : ''} · {x.distanza} m <Fonte url={x.fonte} /></li>)}</ul>
          </> : <p className={c('vuoto')}>La mappa libera non dice chi c’è vicino{s.tipo ? '' : ' (il tipo di attività non è segnato)'}. Guardati intorno: chi vende le stesse cose nella via?</p>}
        </div>
      </section>

      <section className={c('sezione')}><h2>Potenziale</h2><div className={c('riquadro')}><Lista voci={s.potenziale} attesa={attesa} /></div></section>
      </>}

      {pagina === 'dati' && <>

      <section className={c('sezione')}><h2>I dati dell’attività</h2>
        <p className={c('nota')}>Ogni dato dice da dove viene e quanto è sicuro. «Da confermare» vuol dire letto in un elenco, sulla mappa o in una ricerca, non ancora visto dal titolare.</p>
        <div className={c('tabella')}><table className={c('pila')}><thead><tr><th>Voce</th><th>Valore</th><th>Quanto è sicuro</th><th>Fonte</th></tr></thead>
          <tbody>{s.campi.map((dato, i) => (
            <tr key={i}><td>{dato.voce}</td><td>{dato.valore ?? <span className={c('vuoto')}>—</span>}</td><td><span className={c(`stato ${dato.stato}`)}>{STATI[dato.stato]}</span></td><td><Fonte url={dato.fonte} /></td></tr>
          ))}</tbody></table></div>
      </section>

      {(s.fonti.length > 0 || s.avvisi.length > 0) && (
        <section className={c('sezione')}><h2>Fonti e avvisi</h2>
          {s.fonti.length > 0 && <div className={c('riquadro')}><ul>{s.fonti.map((x, i) => <li key={i}><a href={x.url} target="_blank" rel="noopener noreferrer">{x.titolo}</a> <span className={c('fonte')}>{dominio(x.url)}</span></li>)}</ul></div>}
          {s.avvisi.length > 0 && <div className={c('riquadro')}><ul className={c('nota')}>{s.avvisi.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
        </section>
      )}
      </>}

      <nav className={c('avanti')} aria-label="Le altre parti della scheda">
        {prima ? <button type="button" className={c('bottone secondario')} onClick={() => vai(prima.id, true)}>‹ {prima.titolo}</button> : <span />}
        {dopo && <button type="button" className={c('bottone')} onClick={() => vai(dopo.id, true)}>Avanti: {dopo.titolo} ›</button>}
      </nav>
      <p className={c('piede')}>Indirizzi, tipi e concorrenti: © OpenStreetMap contributors (licenza ODbL). Ricerca e giudizio: l’AD di MyCity. Nessun dato di Google viene copiato: la scheda Google si guarda dal link.</p>
    </article>
  );
}
