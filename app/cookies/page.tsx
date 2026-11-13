'use client';

import Link from 'next/link';
import { openConsentBanner } from '@/components/CookieBanner';
import { Cookie } from 'lucide-react';
import { LegalLayout, LegalSection } from '@/components/ui/LegalLayout';
import { titolare, recapitoPrivacy } from '@/lib/legal/titolare';
import { SHOPPING_MODE_MAX_AGE } from '@/lib/shopping-access';

/** 5/11/2026 — La durata della modalità negozio letta dalla costante del middleware (era «Sessione»). */
const DURATA_MODALITA_NEGOZIO = `${Math.round(SHOPPING_MODE_MAX_AGE / 3600)} ore`;

const VERSION = '2.0';
const EFFECTIVE_DATE = '1 novembre 2026';

const TOC = [
  { id: 'cosa-sono', label: 'Cosa sono i cookie' },
  { id: 'tipologie', label: 'Tipologie di cookie' },
  { id: 'gestione', label: 'Gestire le preferenze' },
  { id: 'extra-ue', label: 'Trasferimenti extra-UE' },
  { id: 'aggiornamenti', label: 'Aggiornamenti' },
];

export default function CookiesPage() {
  const chiSiamo = titolare();
  // 27/10/2026 — Come la pagina privacy: la casella vera se c'è, il modulo dei
  // contatti se no. Mai il ripiego scritto nel codice, che forse nessuno legge.
  const recapito = recapitoPrivacy(chiSiamo);

  return (
    <LegalLayout
      title="Cookie policy"
      active="/cookies"
      meta={<>Versione {VERSION} — in vigore dal {EFFECTIVE_DATE}</>}
      summary="Usiamo i cookie per far funzionare il sito, ricordare le tue preferenze e — solo col tuo consenso — misurare il traffico. Non usiamo cookie di profilazione pubblicitaria di terze parti."
      toc={TOC}
    >
      <LegalSection id="cosa-sono" heading="1. Cosa sono i cookie">
        <p>
          I cookie sono piccoli file di testo che i siti memorizzano sul tuo dispositivo per
          farlo funzionare, ricordare le tue preferenze o raccogliere statistiche. Oltre ai
          cookie usiamo tecnologie simili (localStorage, sessionStorage, pixel) che soggiacciono
          alle stesse regole di consenso ai sensi dell&apos;art. 122 D.Lgs. 196/2003 e delle{' '}
          <a
            href="https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9677876"
            target="_blank" rel="noopener noreferrer"
            className="text-primary-700 underline"
          >
            Linee guida cookie del Garante (2021)
          </a>.
        </p>
      </LegalSection>

      <LegalSection id="tipologie" heading="2. Tipologie di cookie usati">
        <h3 className="font-semibold text-ink-900 mt-4 mb-2">2.1 Cookie tecnici (sempre attivi)</h3>
        <p>
          Necessari al funzionamento del sito. Non richiedono consenso preventivo.
        </p>
        {/* #74 — Questa tabella era scritta a memoria e non corrispondeva ai
            cookie veri: ne dichiarava uno che non esiste (mc_pref_*) e ne
            taceva quattro che esistono (NEXT_LOCALE, mycity_shopping_mode,
            mc_sid, mc_exp_*). Una cookie policy che elenca cose diverse da
            quelle che il sito installa e' esattamente cio' che il Garante
            guarda per primo. Rifatta leggendo il codice. */}
        <CookieTable rows={[
          // 31/10/2026 (ondata 6) — Diceva «1 settimana» e la libreria lo teneva 400 giorni: il browser
          // adesso lo taglia a 6 mesi (lib/supabase/client.ts), come la scelta sui cookie.
          { name: 'sb-*-auth-token', purpose: 'Sessione utente (Supabase Auth): ti tiene dentro il tuo account finché non esci', duration: '6 mesi', provider: 'Prima parte' },
          { name: 'mc_consent', purpose: 'Memorizza le tue scelte sui cookie (versione breve, leggibile dal server)', duration: '6 mesi', provider: 'Prima parte' },
          { name: 'mc_consent_v1', purpose: 'Le stesse scelte, salvate nel browser per mostrarti lo stato nel banner', duration: 'Finché non le cambi', provider: 'Prima parte (archivio locale)' },
          { name: 'NEXT_LOCALE', purpose: 'La lingua che hai scelto per il sito', duration: '1 anno', provider: 'Prima parte' },
          { name: 'mycity_shopping_mode', purpose: 'Per i venditori: ricorda se stai navigando come negozio o come cliente', duration: DURATA_MODALITA_NEGOZIO, provider: 'Prima parte' },
          { name: 'mc_cid', purpose: 'Identificativo del registro dei consensi: serve solo a legare la scelta che hai fatto sui cookie a chi l\'ha fatta, quando non hai un account. Non è leggibile dal browser e non serve a profilare.', duration: '6 mesi', provider: 'Prima parte' },
          // 22/8/2026 — c'era e non era dichiarato. Un cookie tecnico non ha
          // bisogno del consenso, ma va scritto nell'informativa lo stesso:
          // quello che non si dichiara sembra nascosto.
          { name: 'mc_ruolo', purpose: 'Ricorda per pochi minuti il tuo ruolo e se il tuo negozio è approvato, così non serve rileggere il profilo dal database a ogni pagina. Contiene il tuo identificativo interno (un codice, non il nome né l\'email), è firmato e non è leggibile dal browser.', duration: '10 minuti', provider: 'Prima parte' },
          // 5/11/2026 — mc_sid stava fra i cookie di analisi «che richiedono consenso», ma nasce
          // anche senza: serve al registro degli accessi (components/ActivityTracker.tsx).
          { name: 'mc_sid', purpose: 'Identificativo della singola visita, nell\'archivio della scheda: tiene insieme gli accessi e le uscite dal tuo account nel registro di sicurezza e, solo se accetti le statistiche, le pagine viste nella stessa visita. Si cancella chiudendo la scheda.', duration: 'Sessione', provider: 'Prima parte (archivio della scheda)' },
          // 1/11/2026 — Il segno del rientro col link di recupero (lib/auth/segno-recupero.ts).
          // 13/11/2026 (R19-009) — La bozza della cassa (lib/bozza-checkout.ts, BOZZA_VALE_MS): non era dichiarata.
          { name: 'mc_checkout_draft', purpose: 'Se compili la cassa senza aver fatto l\'accesso, tiene i dati che hai scritto (nome, indirizzo, telefono, note, fascia e pagamento) mentre accedi o ti registri, così non li riscrivi. Si cancella appena torni in cassa, quando esci dall\'account e comunque dopo 2 ore.', duration: '2 ore', provider: 'Prima parte (archivio locale)' },
          { name: 'mycity_recupero', purpose: 'Dopo che hai aperto il link per scegliere una nuova password, ricorda per un\'ora che vieni da quel link, così puoi cambiarla. È firmato, non è leggibile dal browser e non contiene dati personali.', duration: '1 ora', provider: 'Prima parte' },
          { name: '__cf_bm', purpose: 'Anti-bot Cloudflare (sicurezza)', duration: '30 minuti', provider: 'Cloudflare' },
          { name: 'cf-turnstile-*', purpose: 'CAPTCHA Turnstile', duration: 'Sessione', provider: 'Cloudflare' },
          { name: '__stripe_mid / __stripe_sid', purpose: 'Anti-frode pagamenti', duration: '1 anno / 30 min', provider: 'Stripe' },
        ]} />

        <h3 className="font-semibold text-ink-900 mt-4 mb-2">2.2 Cookie funzionali (richiede consenso)</h3>
        {/* 5/11/2026 — Diceva «memorizzano lingua, ultima ricerca, mappa salvata» e subito
            dopo «non ne installiamo»: la lingua è un cookie tecnico, il resto non esiste. */}
        {/* #74 — `mc_pref_*` non esiste in questo sito: era rimasto scritto qui
            da una versione mai fatta. Le preferenze vere (lingua, modalita'
            negozio) sono cookie tecnici e stanno nella tabella sopra. */}
        <p className="text-sm text-ink-500">
          Oggi non ne installiamo. Lingua e modalità negozio sono cookie tecnici (tabella sopra).
        </p>

        <h3 className="font-semibold text-ink-900 mt-4 mb-2">2.3 Cookie di analisi (richiede consenso)</h3>
        <p>
          Statistiche sull&apos;uso del sito a fini di miglioramento del servizio.
          I dati sono pseudonimizzati (non anonimi) e conservati per un massimo di 14 mesi.
        </p>
        <CookieTable rows={[
          // 5/11/2026 — Diceva «14 mesi», che è la conservazione dei dati da Google: il sito non
          // fissa la vita del cookie (cookie_expires), quindi vale quella predefinita di GA4.
          { name: '_ga / _ga_*', purpose: 'Statistiche di utilizzo (se attivato)', duration: '2 anni, rinnovati a ogni visita', provider: 'Google Analytics 4' },
          { name: 'ph_* / ph_phc_*', purpose: 'PostHog: statistiche di utilizzo e registrazione della sessione di navigazione (session replay). Attivi solo con il consenso ai cookie analitici; i campi di inserimento vengono mascherati nella registrazione.', duration: '12 mesi', provider: 'PostHog Inc. (Stati Uniti)' },
          { name: 'mc_vid', purpose: 'Identificatore di visita MyCity: correla le sessioni ricorrenti dello stesso dispositivo e le collega all\'account al login (profilazione pseudonima cross-sessione). Base giuridica: consenso (art. 6.1.a GDPR).', duration: '12 mesi', provider: 'Prima parte' },
          { name: 'mc_exp_*', purpose: 'A quale variante di una prova A/B sei stato assegnato, così la pagina non cambia sotto i tuoi occhi da una visita all\'altra.', duration: '90 giorni', provider: 'Prima parte' },
          // 12/11/2026 (R02-015) — Il freno «visita già contata» e l'impronta delle visite anonime
          // stanno nell'archivio del browser; si scrivono solo col consenso alle statistiche.
          { name: 'mc_viewed_* / mc_impronta_visite', purpose: 'Contano una sola visita all\'ora per ogni scheda prodotto (anche con più schede aperte) e, se non hai un account, distinguono una persona da duecento visite automatiche. Un codice casuale, non dice chi sei; scaduta l\'ora si cancella alla visita successiva.', duration: '1 ora', provider: 'Prima parte (archivio locale)' },
        ]} />

        <h3 className="font-semibold text-ink-900 mt-4 mb-2">2.4 Cookie di marketing (richiede consenso)</h3>
        <p>
          Annunci personalizzati e remarketing. Attualmente <strong>non installati</strong>;
          la sezione resta a documentare l&apos;eventuale futura attivazione.
        </p>
      </LegalSection>

      <LegalSection id="gestione" heading="3. Come gestire le preferenze">
        <p>
          Puoi modificare le tue scelte in qualunque momento riaprendo il banner cookie:
        </p>
        <button
          type="button"
          onClick={openConsentBanner}
          className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800"
        >
          <Cookie size={18} aria-hidden /> Apri preferenze cookie
        </button>
        <p className="mt-3 text-sm">
          In alternativa puoi disabilitare i cookie dalle impostazioni del browser:
          {' '}<a className="text-primary-700 underline" href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer">Chrome</a>,
          {' '}<a className="text-primary-700 underline" href="https://support.mozilla.org/it/kb/Attivare%20e%20disattivare%20i%20cookie" target="_blank" rel="noopener noreferrer">Firefox</a>,
          {' '}<a className="text-primary-700 underline" href="https://support.apple.com/it-it/guide/safari/sfri11471/mac" target="_blank" rel="noopener noreferrer">Safari</a>,
          {' '}<a className="text-primary-700 underline" href="https://support.microsoft.com/it-it/microsoft-edge/eliminare-i-cookie-in-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09" target="_blank" rel="noopener noreferrer">Edge</a>.
        </p>
        <p className="text-sm">
          Disabilitare i cookie tecnici impedirà il funzionamento corretto del sito (login,
          carrello, sicurezza).
        </p>
      </LegalSection>

      <LegalSection id="extra-ue" heading="4. Trasferimenti extra-UE">
        <p>
          Alcuni provider hanno sede negli Stati Uniti (Cloudflare, Google, Stripe Inc.,
          Anthropic, Resend, PostHog Inc.). I trasferimenti sono coperti dalle Standard Contractual Clauses
          adottate dalla Commissione Europea con Decisione 2021/914.
        </p>
      </LegalSection>

      <LegalSection id="aggiornamenti" heading="5. Aggiornamenti">
        <p>
          Aggiorniamo questa policy ogni volta che vengono aggiunti, rimossi o modificati cookie
          o tecnologie di tracciamento. Conserviamo le versioni precedenti su richiesta{' '}
          {recapito.eUnaCasella ? (
            <>a <a href={recapito.href} className="text-primary-700 underline">{recapito.testo}</a></>
          ) : (
            // 5/11/2026 — Togliere la parentesi «la casella non è ancora attiva»: con quella del
            // referente faceva due parentesi di fila, e l'informativa privacy non lo dice.
            <>dal <Link href={recapito.href} className="text-primary-700 underline">modulo dei contatti</Link></>
          )}
          {chiSiamo.referentePrivacy ? <> (referente: {chiSiamo.referentePrivacy})</> : null}.
        </p>
        <p className="text-sm">
          Per maggiori informazioni sul trattamento dei tuoi dati consulta l&apos;
          <Link href="/privacy" className="text-primary-700 underline">Informativa sulla privacy</Link>.
        </p>
      </LegalSection>

      {/* 5/11/2026 — Qui c'era un riquadro pubblico «Avviso legale» con una nota interna:
          elenco e descrizione dei cookie vanno aggiornati ogni volta che si integra o si
          rimuove un provider terzo; auditare periodicamente (Cookie-Script, iubenda). La nota
          resta qui, per chi lavora sul codice. */}
    </LegalLayout>
  );
}

function CookieTable({ rows }: { rows: Array<{ name: string; purpose: string; duration: string; provider: string }> }) {
  return (
    // 5/11/2026 — Su schermo stretto la tabella scorre di lato: il contenitore deve
    // ricevere il fuoco, se no da tastiera le colonne a destra non si leggono.
    <div
      className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- un contenitore che scorre deve ricevere il fuoco (WCAG 2.1.1, axe scrollable-region-focusable)
      tabIndex={0}
      role="region"
      aria-label="Tabella dei cookie (scorre di lato)"
    >
      <table className="min-w-full border border-cream-300 text-sm">
        <thead className="bg-cream-50">
          <tr>
            <th className="border px-3 py-2 text-left">Cookie</th>
            <th className="border px-3 py-2 text-left">Finalità</th>
            <th className="border px-3 py-2 text-left">Durata</th>
            <th className="border px-3 py-2 text-left">Provider</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="border px-3 py-2 font-mono text-xs">{r.name}</td>
              <td className="border px-3 py-2">{r.purpose}</td>
              <td className="border px-3 py-2">{r.duration}</td>
              <td className="border px-3 py-2">{r.provider}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
