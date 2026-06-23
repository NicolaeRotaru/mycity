import Link from 'next/link';
import { LegalLayout, LegalSection } from '@/components/ui/LegalLayout';

export const metadata = {
  title: 'Termini di servizio · MyCity',
  description: 'Termini e condizioni d\'uso del marketplace MyCity.',
  alternates: { canonical: '/terms' },
  openGraph: {
    title: 'Termini di servizio · MyCity',
    description: 'Termini e condizioni d\'uso del marketplace MyCity.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/terms',
  },
};

const VERSION = '2.0';
const EFFECTIVE_DATE = '24 maggio 2026';

const TOC = [
  { id: 'premesse', label: '1 · Premesse e definizioni' },
  { id: 'natura', label: '2 · Natura del Servizio' },
  { id: 'registrazione', label: '3 · Registrazione e account' },
  { id: 'ordini', label: '4 · Ordini e contratto' },
  { id: 'pagamenti', label: '5 · Pagamenti' },
  { id: 'consegne', label: '6 · Consegne' },
  { id: 'recesso', label: '7 · Diritto di recesso' },
  { id: 'garanzia', label: '8 · Garanzia di conformità' },
  { id: 'venditori', label: '9 · Obblighi dei Venditori' },
  { id: 'rider', label: '10 · Obblighi dei Rider' },
  { id: 'contenuti-utenti', label: '11 · Contenuti utenti' },
  { id: 'condotte-proibite', label: '12 · Condotte proibite' },
  { id: 'responsabilita', label: '13 · Limitazione di responsabilità' },
  { id: 'cessazione', label: '14 · Sospensione e cessazione' },
  { id: 'modifiche', label: '15 · Modifiche ai Termini' },
  { id: 'odr', label: '16 · Risoluzione controversie' },
  { id: 'legge', label: '17 · Legge e foro competente' },
  { id: 'contatti', label: '18 · Contatti' },
];

export default function TermsPage() {
  return (
    <LegalLayout
      title="Termini di servizio"
      active="/terms"
      meta={<>Versione {VERSION} — in vigore dal {EFFECTIVE_DATE}</>}
      summary="MyCity mette in contatto te e i negozi di Piacenza: paghi alla consegna, hai 14 giorni per il recesso e i tuoi dati restano tuoi. Il contratto di vendita si conclude direttamente con il negozio."
      toc={TOC}
    >
      <LegalSection id="premesse" heading="1. Premesse e definizioni">
        <p>
          I presenti Termini di Servizio (&quot;<strong>Termini</strong>&quot;) regolano l&apos;utilizzo
          della piattaforma MyCity (il &quot;<strong>Servizio</strong>&quot;), gestita da
          <strong> MyCity S.r.l.</strong>, con sede in Via Roma 1, 29121 Piacenza (PC), Italia,
          P.IVA IT00000000000, REA PC-000000, PEC mycity@pec.it (di seguito &quot;MyCity&quot;, &quot;noi&quot;).
        </p>
        <p>
          <strong>Definizioni:</strong> &quot;<strong>Acquirente</strong>&quot; o &quot;<strong>Utente</strong>&quot;
          è la persona fisica o giuridica che acquista tramite il Servizio;
          &quot;<strong>Venditore</strong>&quot; è il professionista titolare di partita IVA che
          offre i propri prodotti tramite il Servizio; &quot;<strong>Rider</strong>&quot; è il
          soggetto, autonomo o parasubordinato, che esegue le consegne;
          &quot;<strong>Contenuti</strong>&quot; sono tutti i dati pubblicati sulla piattaforma.
        </p>
        <p>
          Accedendo o utilizzando il Servizio dichiari di aver letto, compreso e accettato i
          presenti Termini, l&apos;<Link href="/privacy" className="text-primary-700 underline">Informativa
          sulla privacy</Link> e la <Link href="/cookies" className="text-primary-700 underline">Cookie
          policy</Link>.
        </p>
      </LegalSection>

      <LegalSection id="natura" heading="2. Natura del Servizio (P2B Regulation)">
        <p>
          MyCity è un servizio di intermediazione online ai sensi del Regolamento (UE) 2019/1150
          (&quot;P2B Regulation&quot;): mette in contatto Acquirenti e Venditori e facilita pagamenti
          e consegne. <strong>Il contratto di compravendita si conclude direttamente tra Acquirente
          e Venditore</strong>; MyCity non è parte di tale contratto e non è proprietario dei beni
          venduti.
        </p>
        <p>
          <strong>Ranking dei risultati di ricerca</strong> e visibilità dei prodotti dipendono da:
          (a) rilevanza testuale rispetto alla query; (b) distanza geografica dal punto di consegna
          dell&apos;Acquirente; (c) rating medio del Venditore; (d) disponibilità in stock e orari
          di apertura; (e) eventuale acquisto di posizionamento sponsorizzato (chiaramente etichettato
          come &quot;Sponsorizzato&quot;).
        </p>
        <p>
          <strong>Importanza relativa dei parametri</strong> (art. 5 P2B): per i risultati
          <em>organici</em> il fattore prevalente è la rilevanza rispetto alla query, seguita dalla
          distanza geografica (un marketplace locale privilegia la prossimità per tempi e costi di
          consegna), poi dal rating del Venditore e dalla disponibilità/orari. I contenuti
          <em>sponsorizzati</em> NON alterano l&apos;ordine dei risultati organici: appaiono in spazi
          separati ed etichettati &quot;Sponsorizzato&quot;, e il pagamento influenza solo quegli
          spazi dedicati, mai il posizionamento organico. Nessun parametro consente a un Venditore di
          ottenere un posizionamento organico migliore tramite pagamento diretto a MyCity.
        </p>
      </LegalSection>

      <LegalSection id="registrazione" heading="3. Registrazione e account">
        <p>
          Per utilizzare il Servizio devi avere almeno <strong>18 anni</strong> e creare un account
          fornendo dati veritieri, completi e aggiornati. Sei responsabile della riservatezza delle
          credenziali e di ogni attività svolta tramite il tuo account.
        </p>
        <p>
          <strong>Verifica email</strong> obbligatoria. Per Venditori e Rider è inoltre richiesta
          la <strong>verifica KYC</strong> (documento d&apos;identità, codice fiscale, P.IVA se
          applicabile, IBAN, assicurazione RC per i Rider).
        </p>
        <p>
          Devi avvisarci immediatamente di ogni uso non autorizzato del tuo account scrivendo a{' '}
          <a href="mailto:security@mycity.it" className="text-primary-700 underline">security@mycity.it</a>.
        </p>
      </LegalSection>

      <LegalSection id="ordini" heading="4. Ordini e formazione del contratto">
        <p>
          L&apos;invio dell&apos;ordine costituisce proposta di acquisto irrevocabile; il contratto
          si perfeziona con l&apos;accettazione del Venditore (che può rifiutare per indisponibilità
          o motivi giustificati). In caso di rifiuto, il pagamento è rimborsato integralmente.
        </p>
        <p>
          I prezzi sono comprensivi di IVA. Le spese di spedizione sono calcolate al checkout in
          base a peso, distanza e modalità di consegna scelta.
        </p>
      </LegalSection>

      <LegalSection id="pagamenti" heading="5. Pagamenti">
        <p>
          I pagamenti sono gestiti da provider PSP autorizzati (Stripe, S.A.). MyCity, in qualità
          di marketplace facilitator, incassa l&apos;importo dell&apos;ordine in custodia
          (&quot;<strong>escrow</strong>&quot;) e lo trasferisce al Venditore (al netto della
          commissione di servizio) dopo la conferma di consegna o, comunque, alla scadenza del
          periodo di recesso (14 giorni).
        </p>
        <p>
          Modalità accettate: carta di credito/debito (Visa, Mastercard, Amex), Apple Pay,
          Google Pay e, dove indicato dal Venditore, pagamento alla consegna in contanti.
        </p>
        <p>
          <strong>Documenti fiscali</strong>: MyCity è un intermediario e <strong>non emette
          fatture</strong> per gli ordini. Ogni adempimento fiscale relativo alla vendita
          (ricevuta, fattura, ecc.) è di esclusiva responsabilità del Venditore, secondo la
          normativa applicabile. L&apos;Acquirente che necessiti di una fattura deve richiederla
          direttamente al Venditore.
        </p>
      </LegalSection>

      <LegalSection id="consegne" heading="6. Consegne">
        <p>
          Le consegne sono affidate a Rider partner. I tempi indicati sono stimati e non
          vincolanti, salvo diversa garanzia espressa. È responsabilità dell&apos;Acquirente
          essere reperibile all&apos;indirizzo indicato; in caso di assenza il Rider tenterà
          il contatto telefonico e, in caso di esito negativo dopo tre tentativi, l&apos;ordine
          potrà essere annullato con rimborso al netto delle spese di consegna sostenute.
        </p>
      </LegalSection>

      <LegalSection id="recesso" heading="7. Diritto di recesso (consumatori)">
        <p>
          Ai sensi degli artt. 52 e ss. del D.Lgs. 206/2005 (Codice del Consumo), l&apos;Acquirente
          che agisce come consumatore ha diritto di recedere dal contratto entro{' '}
          <strong>14 giorni</strong> dalla consegna, senza necessità di motivare la richiesta.
        </p>
        <p>
          Sono esclusi dal recesso, ai sensi dell&apos;art. 59 Cod. Cons.: prodotti deperibili,
          prodotti confezionati su misura o personalizzati, prodotti sigillati (per igiene) aperti
          dopo la consegna, beni che dopo la consegna risultino mescolati con altri beni in modo
          non separabile, contenuti digitali forniti su supporto non materiale dopo l&apos;avvio
          dell&apos;esecuzione.
        </p>
        <p>
          Per esercitare il recesso usa il flusso &quot;Richiedi reso&quot; nel dettaglio ordine
          o scrivi a <a href="mailto:resi@mycity.it" className="text-primary-700 underline">resi@mycity.it</a>.
          Le spese di restituzione sono a carico dell&apos;Acquirente salvo prodotto difettoso o
          errore del Venditore.
        </p>
        <p>
          Il rimborso è effettuato entro 14 giorni dalla ricezione della merce restituita, con lo
          stesso mezzo di pagamento usato per l&apos;acquisto.
        </p>
      </LegalSection>

      <LegalSection id="garanzia" heading="8. Garanzia legale di conformità">
        <p>
          Per i consumatori si applica la <strong>garanzia legale di conformità di 24 mesi</strong>{' '}
          (D.Lgs. 170/2021). In caso di difetto, l&apos;Acquirente ha diritto, a sua scelta, alla
          riparazione o sostituzione gratuita; se non possibili, alla riduzione del prezzo o
          risoluzione del contratto.
        </p>
      </LegalSection>

      <LegalSection id="venditori" heading="9. Obblighi dei Venditori">
        <p>I Venditori si impegnano a:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>pubblicare informazioni veritiere, complete e non ingannevoli;</li>
          <li>rispettare la normativa fiscale ed emettere in proprio la documentazione richiesta (ricevuta/fattura) secondo la legge applicabile;</li>
          <li>garantire la conformità dei prodotti e rispondere della garanzia legale;</li>
          <li>evadere gli ordini entro i tempi indicati o, in caso di impossibilità, annullarli tempestivamente;</li>
          <li>non vendere prodotti contraffatti, illegali o vietati ai minori senza adeguati controlli;</li>
          <li>collaborare nella gestione di dispute, resi e reclami.</li>
        </ul>
        <p>
          La <strong>commissione di servizio</strong> trattenuta da MyCity è pari all&apos;8% del
          valore dell&apos;ordine, IVA esclusa. Eventuali variazioni saranno comunicate con
          preavviso di 30 giorni come da art. 15.
        </p>
      </LegalSection>

      <LegalSection id="rider" heading="10. Obblighi dei Rider">
        <p>
          I Rider operano come lavoratori autonomi o parasubordinati. Devono essere in possesso
          di assicurazione RC, patente di guida valida (se applicabile), idoneità sanitaria (se
          consegnano alimenti), e rispettare il codice della strada e le norme di igiene.
        </p>
      </LegalSection>

      <LegalSection id="contenuti-utenti" heading="11. Contenuti pubblicati dagli utenti">
        <p>
          Recensioni, foto e domande pubblicate dagli Utenti devono essere veritieri, originali e
          non lesivi di diritti di terzi. MyCity si riserva il diritto di moderare, oscurare o
          rimuovere contenuti contrari ai presenti Termini, alla legge o al buon costume.
        </p>
        <p>
          Pubblicando Contenuti concedi a MyCity una licenza non esclusiva, gratuita e mondiale
          per ospitarli, riprodurli e mostrarli all&apos;interno del Servizio.
        </p>
      </LegalSection>

      <LegalSection id="condotte-proibite" heading="12. Contenuti e condotte proibiti">
        <p>È vietato:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>pubblicare contenuti illegali, contraffatti, offensivi, ingannevoli, discriminatori;</li>
          <li>tentare di aggirare i sistemi di sicurezza o di rate limiting;</li>
          <li>effettuare scraping massivo del catalogo o reverse engineering;</li>
          <li>creare account multipli per ottenere bonus o ingannare il sistema referral;</li>
          <li>utilizzare il Servizio per attività di riciclaggio o finanziamento di attività illecite.</li>
        </ul>
        <p>
          La violazione comporta sospensione o cancellazione dell&apos;account, oltre ad azioni
          legali e segnalazione alle autorità competenti.
        </p>
      </LegalSection>

      <LegalSection id="responsabilita" heading="13. Limitazione di responsabilità">
        <p>
          MyCity fornisce il Servizio &quot;as is&quot; e non garantisce continuità ininterrotta o
          assenza di errori. Nei limiti consentiti dalla legge, MyCity non è responsabile per:
          (a) la qualità, conformità o sicurezza dei prodotti venduti dai Venditori;
          (b) eventuali ritardi nelle consegne; (c) danni indiretti, perdita di profitti o dati
          derivanti dall&apos;uso del Servizio.
        </p>
        <p>
          Resta ferma la responsabilità inderogabile di MyCity per dolo o colpa grave, danni alla
          persona e violazioni dei diritti dei consumatori.
        </p>
      </LegalSection>

      <LegalSection id="cessazione" heading="14. Sospensione e cessazione">
        <p>
          MyCity può sospendere o chiudere il tuo account, dandone comunicazione, in caso di:
          (a) violazione dei Termini; (b) attività sospette di frode; (c) ordini interrogazione di
          autorità competenti. Puoi cancellare il tuo account in qualsiasi momento dalla pagina
          <Link href="/profile/settings" className="text-primary-700 underline"> Impostazioni</Link>.
        </p>
      </LegalSection>

      <LegalSection id="modifiche" heading="15. Modifiche ai Termini">
        <p>
          Possiamo modificare i presenti Termini in qualsiasi momento. Le modifiche sostanziali
          saranno comunicate con preavviso di <strong>30 giorni</strong> via email e notifica in
          piattaforma. L&apos;uso continuato del Servizio dopo l&apos;entrata in vigore costituisce
          accettazione delle modifiche. Se non accetti, puoi cancellare l&apos;account prima
          dell&apos;entrata in vigore.
        </p>
      </LegalSection>

      <LegalSection id="odr" heading="16. Risoluzione delle controversie (ODR)">
        <p>
          Per i consumatori è disponibile la piattaforma europea di risoluzione delle controversie
          online (ODR):{' '}
          <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer" className="text-primary-700 underline">
            ec.europa.eu/consumers/odr
          </a>.
          Inoltre, puoi contattare il nostro servizio clienti scrivendo a{' '}
          <a href="mailto:reclami@mycity.it" className="text-primary-700 underline">reclami@mycity.it</a>.
        </p>
      </LegalSection>

      <LegalSection id="legge" heading="17. Legge applicabile e foro competente">
        <p>
          I presenti Termini sono regolati dalla <strong>legge italiana</strong>. Per le controversie
          con consumatori è competente in via esclusiva il foro del luogo di residenza o domicilio
          del consumatore. Per le controversie con professionisti è competente il <strong>Foro di
          Piacenza</strong>.
        </p>
      </LegalSection>

      <LegalSection id="contatti" heading="18. Contatti">
        <p>
          Per domande sui Termini scrivi a{' '}
          <a href="mailto:legal@mycity.it" className="text-primary-700 underline">legal@mycity.it</a>{' '}
          oppure utilizza la <Link href="/contact" className="text-primary-700 underline">pagina contatti</Link>.
        </p>
      </LegalSection>

      <div className="mt-10 p-4 bg-accent-50 border border-accent-200 rounded-lg text-xs text-accent-900">
        <strong>Avviso legale:</strong> questo documento è un modello di partenza ispirato alla
        normativa italiana ed europea (Cod. Cons., GDPR, P2B Regulation, D.Lgs. 170/2021).
        Prima del lancio in produzione DEVE essere validato da un avvocato esperto in diritto
        del consumo e marketplace digitali.
      </div>
    </LegalLayout>
  );
}
