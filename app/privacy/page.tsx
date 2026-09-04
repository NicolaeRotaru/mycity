import Link from 'next/link';
import { LegalLayout, LegalSection } from '@/components/ui/LegalLayout';
import { recapitoPrivacy, titolare } from '@/lib/legal/titolare';

export const metadata = {
  title: 'Informativa sulla privacy · MyCity',
  description: 'Come trattiamo i tuoi dati personali ai sensi del Regolamento UE 2016/679 (GDPR).',
  alternates: { canonical: '/privacy' },
  openGraph: {
    title: 'Informativa sulla privacy · MyCity',
    description: 'Come trattiamo i tuoi dati personali ai sensi del GDPR.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/privacy',
  },
};

const VERSION = '2.0';
const EFFECTIVE_DATE = '24 maggio 2026';

const TOC = [
  { id: 'titolare', label: 'Titolare del trattamento' },
  { id: 'dati', label: 'Dati raccolti' },
  { id: 'finalita', label: 'Finalità e conservazione' },
  { id: 'destinatari', label: 'Destinatari dei dati' },
  { id: 'diritti', label: 'I tuoi diritti' },
  { id: 'sicurezza', label: 'Misure di sicurezza' },
  { id: 'data-breach', label: 'Data breach' },
  { id: 'cookie', label: 'Cookie' },
  { id: 'modifiche', label: 'Modifiche' },
];

export default function PrivacyPage() {
  const ownerData = titolare();
  // 27/8/2026 (R053) — dove si scrive per esercitare i propri diritti. Se la
  // casella della privacy non e' configurata, l'indirizzo scritto nel codice
  // non riceve niente: meglio mandare al modulo dei contatti, che qualcuno
  // legge davvero, che promettere una risposta che non arrivera' mai.
  const dovePerIDiritti = recapitoPrivacy(ownerData);
  return (
    <LegalLayout
      title="Informativa sulla privacy"
      active="/privacy"
      meta={
        <>
          Versione {VERSION} — in vigore dal {EFFECTIVE_DATE}
          <br />
          Ai sensi degli artt. 13-14 Reg. UE 2016/679 (GDPR)
        </>
      }
      summary="Non vendiamo i tuoi dati a terzi. Li trattiamo solo per erogare il servizio, rispettare gli obblighi di legge e — previo consenso — per il marketing. Li condividiamo solo con il negozio e il rider necessari al tuo ordine."
      toc={TOC}
    >
      <LegalSection id="titolare" heading="1. Titolare del trattamento">
        <p>
          Il titolare del trattamento è <strong>{ownerData.denominazione}</strong>
          {ownerData.indirizzo ? <>, con sede in {ownerData.indirizzo}</> : null}
          {ownerData.partitaIva ? <>, P.IVA {ownerData.partitaIva}</> : null}.
        </p>
        <p>
          <strong>Contatti del Titolare:</strong>{' '}
          <a href={dovePerIDiritti.href} className="text-primary-700 underline">{dovePerIDiritti.testo}</a>
          {ownerData.emailDpo ? (
            <>
              <br />
              <strong>Responsabile della protezione dei dati (DPO):</strong>{' '}
              <a href={`mailto:${ownerData.emailDpo}`} className="text-primary-700 underline">{ownerData.emailDpo}</a>
            </>
          ) : null}
        </p>
      </LegalSection>

      <LegalSection id="dati" heading="2. Categorie di dati trattati">
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Dati anagrafici e di contatto:</strong> nome, cognome, email, telefono, indirizzo di consegna e di residenza.</li>
          <li><strong>Dati di account:</strong> credenziali (password hashata), data di registrazione, preferenze, log di accesso, indirizzo IP, user-agent.</li>
          <li><strong>Dati fiscali (Venditori):</strong> codice fiscale, partita IVA, ragione sociale, sede legale, PEC, codice SDI, IBAN.</li>
          <li><strong>Documenti d&apos;identità (KYC per Venditori/Rider):</strong> documento di riconoscimento, patente, certificato HACCP, polizza RC — trattati e conservati con misure di sicurezza rafforzate.</li>
          <li><strong>Dati di transazione:</strong> ordini, importi, metodi di pagamento, ultime 4 cifre della carta (mai il numero completo né il CVV).</li>
          <li><strong>Dati di geolocalizzazione:</strong> posizione del Rider durante la consegna; indirizzo di consegna; posizione approssimativa dell&apos;Acquirente per la funzione &quot;Vicino a te&quot; (solo previo consenso esplicito).</li>
          <li><strong>Contenuti generati dall&apos;utente:</strong> recensioni, foto, messaggi nelle chat ordine.</li>
          {/* 27/8/2026 (R058) — Mancavano, ed è il dato più intrusivo che
              raccogliamo dopo la posizione del Rider: alla consegna in contanti
              il Rider fotografa i contanti e «il pacco lasciato», che nella
              pratica è l'ingresso di casa del cliente. Un trattamento che non
              compare nell'informativa è un trattamento senza informativa. */}
          <li><strong>Prove di consegna (solo pagamento alla consegna):</strong> fotografia del contante ricevuto, fotografia del pacco consegnato (che può ritrarre l&apos;ingresso dell&apos;abitazione) e firma per ricevuta, scattate dal Rider al momento della consegna.</li>
          <li><strong>Dati di navigazione:</strong> pagine visitate, click, tempo di permanenza (se attivi i cookie analytics).</li>
        </ul>
      </LegalSection>

      <LegalSection id="finalita" heading="3. Finalità, basi giuridiche e periodi di conservazione">
        <div className="overflow-x-auto">
          <table className="min-w-full border border-cream-300 text-sm">
            <thead className="bg-cream-50">
              <tr>
                <th className="border px-3 py-2 text-left">Finalità</th>
                <th className="border px-3 py-2 text-left">Base giuridica</th>
                <th className="border px-3 py-2 text-left">Conservazione</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="border px-3 py-2">Creazione e gestione account</td><td className="border px-3 py-2">Esecuzione contratto (art. 6.1.b GDPR)</td><td className="border px-3 py-2">Fino a cancellazione account</td></tr>
              <tr><td className="border px-3 py-2">Esecuzione ordini e consegne</td><td className="border px-3 py-2">Esecuzione contratto</td><td className="border px-3 py-2">10 anni (obblighi fiscali)</td></tr>
              <tr><td className="border px-3 py-2">Fatturazione e contabilità</td><td className="border px-3 py-2">Obbligo di legge (art. 6.1.c)</td><td className="border px-3 py-2">10 anni (art. 2220 c.c.)</td></tr>
              <tr><td className="border px-3 py-2">Verifica KYC e antiriciclaggio</td><td className="border px-3 py-2">Obbligo di legge</td><td className="border px-3 py-2">10 anni dalla cessazione rapporto</td></tr>
              {/* 27/8/2026 (R059) — La riga diceva 12 mesi e il lavoro notturno ne
                  applicava 14, e le righe di accesso non le cancellava mai
                  nessuno. Adesso il codice fa quello che c'è scritto qui, e
                  qui c'è scritto anche cosa succede alla scadenza: non basta
                  togliere l'indirizzo IP, la riga di accesso se ne va. */}
              <tr><td className="border px-3 py-2">Sicurezza, anti-frode</td><td className="border px-3 py-2">Legittimo interesse (art. 6.1.f)</td><td className="border px-3 py-2">12 mesi: dopo, i log di accesso vengono cancellati e l&apos;indirizzo IP azzerato</td></tr>
              <tr><td className="border px-3 py-2">Newsletter e marketing</td><td className="border px-3 py-2">Consenso (art. 6.1.a)</td><td className="border px-3 py-2">Fino a revoca consenso</td></tr>
              <tr><td className="border px-3 py-2">Analytics aggregati</td><td className="border px-3 py-2">Consenso (cookie)</td><td className="border px-3 py-2">14 mesi</td></tr>
              {/* #75 — La posizione del fattorino durante la consegna veniva
                  raccolta di continuo e non compariva in nessuna riga di questa
                  tabella: nessuna base giuridica dichiarata, nessun tempo di
                  conservazione. È il trattamento più invasivo che facciamo, ed
                  è quello che mancava. */}
              <tr><td className="border px-3 py-2">Posizione del Rider durante la consegna</td><td className="border px-3 py-2">Esecuzione del contratto (art. 6.1.b) e legittimo interesse alla sicurezza e tracciabilità della consegna (art. 6.1.f)</td><td className="border px-3 py-2">Cancellata alla chiusura dell&apos;ordine</td></tr>
              {/* 27/8/2026 (R058) — Le foto della consegna non erano dichiarate da
                  nessuna parte e non le cancellava nessuno. Novanta giorni sono
                  il tempo della quadratura di cassa e di un reclamo: dopo, è la
                  fotografia di una casa e basta. */}
              <tr><td className="border px-3 py-2">Prove di consegna e d&apos;incasso (foto e firma)</td><td className="border px-3 py-2">Legittimo interesse alla prova della consegna e alla quadratura di cassa (art. 6.1.f)</td><td className="border px-3 py-2">90 giorni dalla consegna, o fino alla chiusura della contestazione</td></tr>
              {/* 27/8/2026 (R066) — Il registro dei consensi contiene indirizzo
                  IP e programma di navigazione, e non aveva nessuna riga qui.
                  Il numero di mesi vive ora in un posto solo: la funzione
                  `pota_consent_log` del database (migrations/135). */}
              <tr><td className="border px-3 py-2">Prova del consenso ai cookie (registro consensi)</td><td className="border px-3 py-2">Obbligo di rendere conto del consenso (art. 7.1)</td><td className="border px-3 py-2">La prova resta; indirizzo IP e programma di navigazione azzerati dopo 24 mesi</td></tr>
              {/* 3/9/2026 — I BUONI REGALO NON ERANO DICHIARATI DA NESSUNA PARTE.
                  Chi compra un buono scrive nome, email e un messaggio del
                  DESTINATARIO: una persona che non si è mai iscritta e che di
                  noi non sapeva niente. Le parole «regalo» e «gift» non
                  comparivano in questa pagina, e la tabella non aveva la riga:
                  un trattamento di dati di terzi senza informativa. Adesso c'è
                  scritto anche quando quei dati se ne vanno, e il codice fa
                  quello che c'è scritto (lib/account/cancellazione.ts). */}
                            {/* 3/9/2026 — I BUONI REGALO NON ERANO DICHIARATI DA NESSUNA PARTE.
                  Chi compra un buono scrive nome, email e un messaggio del
                  DESTINATARIO: una persona che non si è mai iscritta e che di
                  noi non sapeva niente. Le parole «regalo» e «gift» non
                  comparivano in questa pagina, e la tabella non aveva la riga:
                  un trattamento di dati di terzi senza informativa. Adesso c'è
                  scritto anche quando quei dati se ne vanno, e il codice fa
                  quello che c'è scritto (lib/account/cancellazione.ts). */}
              <tr><td className="border px-3 py-2">Buoni regalo — dati del destinatario (nome, email, messaggio)</td><td className="border px-3 py-2">Legittimo interesse a recapitare il regalo a chi è stato indicato (art. 6.1.f)</td><td className="border px-3 py-2">Nome, email e messaggio del destinatario vengono azzerati quando chi ha comprato il buono cancella il proprio account; il credito resta spendibile fino alla scadenza (2 anni). Il destinatario può chiederne la cancellazione in qualsiasi momento: il modo è scritto nell&apos;email che riceve.</td></tr>
              <tr><td className="border px-3 py-2">Gestione reclami e contenzioso</td><td className="border px-3 py-2">Legittimo interesse</td><td className="border px-3 py-2">Fino a prescrizione (10 anni)</td></tr>
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection id="destinatari" heading="4. Destinatari dei dati (sub-responsabili)">
        <p>
          I tuoi dati sono trattati da fornitori esterni che operano come Responsabili del
          trattamento ex art. 28 GDPR, vincolati da accordo DPA:
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Supabase Inc.</strong> (Stati Uniti — Standard Contractual Clauses) — hosting database, autenticazione, storage.</li>
          <li><strong>Stripe Payments Europe Ltd.</strong> (Irlanda) — gestione pagamenti elettronici, PSP autorizzato.</li>
          <li><strong>Resend Inc.</strong> (Stati Uniti — SCC) — invio email transazionali.</li>
          <li><strong>Cloudflare Inc.</strong> (Stati Uniti — SCC) — CDN, protezione DDoS, CAPTCHA.</li>
          <li><strong>Anthropic PBC</strong> (Stati Uniti — SCC) — funzionalità AI del marketplace: miglioramento descrizioni prodotto, analisi immagini caricate dai venditori, assistente catalogo, riconoscimento vocale prodotto, riassunto recensioni, ricerca per foto. I testi processati possono includere contenuti di schede prodotto e messaggi inviati tramite le funzioni AI; Anthropic non conserva i dati per finalità proprie (accordo API). Dati personali degli acquirenti non vengono inviati ad Anthropic salvo quelli contenuti esplicitamente nelle richieste dell&apos;utente.</li>
          {/* 27/8/2026 (R060) — Mancavano i due fornitori che ricevono i dati
              di OGNI visita, mentre erano dichiarati tre servizi di verifica
              identità che non ricevono niente. Dichiarare chi non tratta e
              tacere chi tratta dice a chi legge che questa pagina è un modello
              copiato — e che tutto il resto va riletto riga per riga. */}
          <li><strong>Vercel Inc.</strong> (Stati Uniti — SCC) — hosting del sito: riceve e registra ogni richiesta, compreso l&apos;indirizzo IP, e conserva i registri tecnici del server.</li>
          <li><strong>Upstash Inc.</strong> (Stati Uniti — SCC) — protezione dagli abusi: memorizza per pochi minuti un contatore per indirizzo IP, per fermare chi tenta troppe richieste di fila.</li>
          <li><strong>Verifica dei documenti d&apos;identità (KYC):</strong> l&apos;esame dei documenti di Venditori e Rider è svolto internamente da MyCity. Se in futuro verrà affidato a un fornitore esterno, il suo nome comparirà qui prima che il primo documento gli venga inviato.</li>
          <li><strong>OpenStreetMap Foundation</strong> (Regno Unito) — geocoding indirizzi.</li>
          {/* 27/8/2026 (R055) — La frase diceva «vengono mascherati i campi di
              inserimento»: vero, e insufficiente. Il testo GIA' SCRITTO nella
              pagina finiva nel filmato così com'era, e sulla pagina degli
              ordini di un negoziante quel testo è nome, telefono e indirizzo
              dei suoi clienti. Adesso il codice maschera tutto il testo e
              spegne la registrazione dove compaiono dati di terzi; questa riga
              dice quello che il codice fa davvero. */}
          <li><strong>PostHog Inc.</strong> (Stati Uniti — SCC) — statistiche di utilizzo e registrazione delle sessioni di navigazione (session replay), attiva solo con il consenso ai cookie analitici. Nel filmato tutto il testo e tutti i campi sono oscurati, e la registrazione è disattivata sulle pagine in cui compaiono dati di altre persone (area del negozio, area del Rider, amministrazione, ordini, pagamento, profilo, messaggi); l&apos;identificativo dell&apos;utente viene collegato dopo l&apos;accesso.</li>
          <li><strong>Functional Software Inc. (Sentry)</strong> (Stati Uniti — SCC) — raccolta degli errori dell&apos;applicazione per la diagnosi dei guasti; può includere indirizzo IP e pagina in cui si è verificato l&apos;errore.</li>
          <li><strong>Google Ireland Ltd.</strong> — misurazione del traffico del sito. È attiva solo se la misurazione è configurata nel sito e solo con il consenso ai cookie analitici: se non è configurata, a Google non arriva nulla.</li>
          {/* #76 — Mancavano i due fornitori che ricevono davvero le foto
              caricate dai negozianti. La funzione «togli lo sfondo» manda
              l'immagine a un servizio esterno: quel servizio riceve un dato che
              non e' nostro, e finora non era dichiarato a nessuno. */}
          <li><strong>Kaleido AI GmbH / Canva (remove.bg)</strong> (Austria/Australia — SCC) — rimozione dello sfondo dalle foto prodotto caricate dai venditori. Riceve la sola immagine, su richiesta esplicita del venditore.</li>
          <li><strong>PhotoRoom SAS</strong> (Francia) — alternativa per la rimozione dello sfondo dalle foto prodotto. Riceve la sola immagine, su richiesta esplicita del venditore.</li>
        </ul>
        <p className="text-sm text-ink-500">
          Dei due fornitori per la rimozione dello sfondo ne è attivo uno solo alla
          volta, scelto nella configurazione del sito: entrambi sono elencati perché
          la scelta può cambiare senza modifiche a questa pagina.
        </p>
        <p>
          <strong>Trasferimenti extra-UE:</strong> sono protetti da Standard Contractual Clauses
          adottate dalla Commissione Europea (Decisione 2021/914).
        </p>
      </LegalSection>

      <LegalSection id="diritti" heading="5. Diritti dell&apos;interessato (artt. 15-22 GDPR)">
        <p>Hai diritto di:</p>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Accedere</strong> ai tuoi dati e ricevere una copia (art. 15);</li>
          <li><strong>Rettificare</strong> dati inesatti o incompleti (art. 16);</li>
          <li><strong>Cancellare</strong> i dati (&quot;diritto all&apos;oblio&quot;) nei casi previsti (art. 17);</li>
          <li><strong>Limitare</strong> il trattamento (art. 18);</li>
          <li><strong>Ricevere</strong> i dati in formato strutturato e leggibile (portabilità, art. 20);</li>
          <li><strong>Opporsi</strong> al trattamento basato sul legittimo interesse o per marketing (art. 21);</li>
          <li><strong>Non essere</strong> sottoposto a decisioni automatizzate con effetti significativi (art. 22).</li>
        </ul>
        <p>
          Puoi esercitare questi diritti dalla pagina{' '}
          <Link href="/profile/settings" className="text-primary-700 underline">Impostazioni → Privacy</Link>{' '}
          (dove trovi i pulsanti &quot;Scarica i miei dati&quot; e &quot;Cancella account&quot;) oppure
          scrivendo a{' '}
          <a href={dovePerIDiritti.href} className="text-primary-700 underline">{dovePerIDiritti.testo}</a>.
        </p>
        <p>
          Hai diritto di presentare reclamo al{' '}
          <a href="https://www.garanteprivacy.it/" target="_blank" rel="noopener noreferrer" className="text-primary-700 underline">
            Garante per la protezione dei dati personali
          </a>{' '}
          (Piazza Venezia 11, 00187 Roma).
        </p>
      </LegalSection>

      <LegalSection id="sicurezza" heading="6. Misure di sicurezza">
        <p>
          Adottiamo misure tecniche e organizzative idonee a proteggere i dati: trasmissione
          crittografata (TLS 1.3), password hashate con bcrypt, accesso ai dati su base
          need-to-know, log di accesso, Row Level Security a livello database, backup giornalieri
          cifrati, formazione del personale, security headers (HSTS, CSP, X-Frame-Options).
        </p>
      </LegalSection>

      <LegalSection id="data-breach" heading="7. Data breach">
        <p>
          In caso di violazione di dati personali che comporti un rischio elevato per i tuoi
          diritti, ti informeremo senza ingiustificato ritardo e notificheremo l&apos;evento al
          Garante entro 72 ore, ai sensi dell&apos;art. 33 GDPR.
        </p>
      </LegalSection>

      <LegalSection id="cookie" heading="8. Cookie">
        <p>
          Per i dettagli sui cookie usati e su come gestire le preferenze, consulta la nostra{' '}
          <Link href="/cookies" className="text-primary-700 underline">Cookie policy</Link>.
        </p>
      </LegalSection>

      <LegalSection id="modifiche" heading="9. Modifiche all&apos;informativa">
        <p>
          Possiamo aggiornare questa informativa per riflettere modifiche normative o operative.
          Le versioni precedenti restano consultabili su richiesta scrivendo a{' '}
          <a href={dovePerIDiritti.href} className="text-primary-700 underline">{dovePerIDiritti.testo}</a>.
        </p>
      </LegalSection>

      <div className="mt-10 p-4 bg-accent-50 border border-accent-200 rounded-lg text-xs text-accent-900">
        <strong>Avviso legale:</strong> questo documento è ispirato al GDPR e alle linee guida del
        Garante italiano. Va validato da un DPO/avvocato prima dell&apos;uso in produzione,
        verificando che i sub-responsabili effettivamente integrati corrispondano a quelli elencati.
      </div>
    </LegalLayout>
  );
}
