/**
 * IL VERDETTO SULLE VARIABILI: SANO, MALATO, OPPURE «NON L'HO POTUTO GUARDARE».
 *
 * 8/9/2026 — PERCHE' QUESTO FILE ESISTE.
 *
 * Sui battiti dei lavori periodici il verdetto sta gia' in una funzione pura
 * (`lib/cron-health.ts`, `esitoBattiti`) che sa dire tre cose diverse: fermo,
 * mai visto, non letto. Sulle variabili d'ambiente no: il verdetto era una riga
 * dentro `app/api/health/route.ts`
 *
 *     ENV_IMPORTANTI.filter((k) => !process.env[k])
 *
 * e quella riga sa dire una cosa sola — «manca» — usando UNA misura sola:
 * l'ambiente del server adesso. Da li' nascono i due buchi che hanno lasciato
 * il semaforo verde mentre il sito era chiuso:
 *
 * ① NON SA COSA HA IN MANO IL BROWSER. Le variabili `NEXT_PUBLIC_*` non le
 *    legge il server: Next le stampa dentro il pacchetto costruito, a tempo di
 *    costruzione, e il browser legge quelle. `process.env[nome]`, con il nome
 *    dentro una variabile, non viene sostituito da Next: legge l'ambiente del
 *    server ADESSO, che e' un'altra domanda e puo' rispondere il contrario.
 *    Quindi la riga qui sopra, su una `NEXT_PUBLIC_*`, non misura niente di
 *    utile — e taceva.
 *
 * ② NON CONOSCE LE COPPIE. Mezza coppia e' peggio di zero, perche' zero non
 *    mente. Con `TURNSTILE_SECRET_KEY` presente e `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
 *    assente, le pagine di accesso e registrazione non disegnano il riquadro
 *    anti-robot, mandano il modulo senza gettone, e il server risponde «CAPTCHA
 *    mancante» a tutti: nessuno entra, nessuno si registra. Con
 *    `STRIPE_SECRET_KEY` presente e `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
 *    assente, dal checkout sparisce il pagamento con carta e restano i contanti.
 *    In tutti e due i casi ogni singola variabile «c'e' o non c'e'» dava una
 *    risposta accettabile, e l'insieme era un guasto totale.
 *
 * LA REGOLA CHE TIENE, E CHE VALE ANCHE DOMANI:
 * un controllo che non riesce a misurare NON E' VERDE. Se la misura non c'e',
 * la parola giusta e' `non_misurabile` e il semaforo lo dice. Un «non lo so» e'
 * un'informazione; un verde finto no — insegna a fidarsi di un cartello che
 * mente, ed e' il danno peggiore che un semaforo possa fare.
 *
 * PERCHE' STA QUI E NON NELLA ROTTA:
 * dentro `route.ts` questa decisione vive insieme a `next/server` e a due query
 * sul database. Nessuna prova puo' eseguirla senza montare mezzo mondo, quindi
 * nessuno la prova, quindi fra un mese torna a mentire — che e' esattamente
 * come si e' rotta la prima volta. Qui e' una funzione pura: si chiama con un
 * oggetto e si guarda cosa risponde.
 */

/** Cosa si e' riusciti a sapere di UNA variabile. */
export type Misura =
  /** C'e' e ha un valore non vuoto. */
  | 'presente'
  /** Misurata davvero, e non c'e' (o e' la stringa vuota). */
  | 'assente'
  /**
   * NON misurata. Non e' un sinonimo di «assente»: vuol dire che da qui non si
   * puo' rispondere. Va detto, non taciuto.
   */
  | 'non_misurabile';

/**
 * Il perche' in UNA parola, che un monitor puo' leggere senza capire
 * l'italiano. Stesso stampo di `StatoBattiti` in lib/cron-health.ts: chi
 * configura un allarme sulle due porte di salute usa una regola sola.
 */
export type StatoVariabili =
  | 'ok'
  /** Una coppia e' a meta': la piu' grave, perche' sembra configurata. */
  | 'coppia_rotta'
  /** Manca qualcosa, e lo sappiamo per certo. */
  | 'mancanti'
  /** Non si e' potuto guardare. Non e' un verde. */
  | 'non_misurate';

export type EsitoVariabili = {
  /** Vero solo se le ha guardate tutte e stavano tutte al loro posto. */
  ok: boolean;
  stato: StatoVariabili;
  /** Quante ne ha davvero misurate. */
  esaminate: number;
  /** Quante ne doveva misurare. Un verde su zero e un verde su diciassette non si assomigliano. */
  attese: number;
  /** I nomi e il perche': si legge di notte, in fretta. */
  error?: string;
};

/**
 * Le variabili che il BROWSER legge dal pacchetto costruito, non dall'ambiente
 * del server. Il prefisso e' l'unico modo di riconoscerle, ed e' quello che usa
 * Next stesso.
 */
export const PREFISSO_BROWSER = 'NEXT_PUBLIC_';

/** Una coppia che o e' intera o e' un guasto. */
export type Coppia = {
  /** Come la chiama una persona: finisce nel messaggio che si legge alle tre di notte. */
  nome: string;
  variabili: readonly string[];
  /** Cosa si spegne quando la coppia e' a meta'. Detto in italiano, non in sigle. */
  rompe: string;
};

/**
 * LE COPPIE. Una meta' sola non e' «meta' funzione»: e' una funzione spenta che
 * si comporta come una accesa.
 *
 * Upstash era gia' sorvegliata (radiografia del 27/8/2026), ma la regola era
 * scritta solo nel commento accanto all'elenco, non nel codice: bastava
 * aggiungere una coppia nuova per non ereditarla. Adesso e' un dato, e le
 * coppie nuove si aggiungono qui.
 */
export const COPPIE_INTERE_O_GUASTO: readonly Coppia[] = [
  {
    nome: 'Turnstile (controllo anti-robot)',
    variabili: ['TURNSTILE_SECRET_KEY', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY'],
    rompe:
      'le pagine non disegnano il riquadro anti-robot e mandano il modulo senza gettone: ' +
      'il server risponde «CAPTCHA mancante» su accesso, registrazione, contatti e newsletter',
  },
  {
    nome: 'Stripe (pagamento con carta)',
    variabili: ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
    rompe: 'dal checkout sparisce il pagamento con carta e restano solo i contanti alla consegna',
  },
  {
    nome: 'Upstash (freno anti-abuso condiviso)',
    variabili: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    rompe: 'il freno ripiega in silenzio sul contatore in memoria, uno per ogni copia della funzione',
  },
  {
    nome: 'Resend (posta)',
    variabili: ['RESEND_API_KEY', 'RESEND_FROM'],
    rompe: 'la busta parte senza mittente verificato e Resend la rifiuta: non arriva nessuna email',
  },
  {
    nome: 'VAPID (notifiche push)',
    variabili: ['VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY'],
    rompe: 'le notifiche push non partono',
  },
];

/**
 * Una variabile c'e' solo se ha un valore non vuoto. Su Vercel capita spesso di
 * svuotare il valore lasciando la riga: `''` e' assente, non presente. Stessa
 * regola di `readEnv` in lib/env.ts, cosi' il semaforo e il codice che usa la
 * variabile la pensano allo stesso modo.
 */
export function valorePresente(v: string | undefined | null): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * DA DUE LETTURE DIVERSE A UNA MISURA PER OGNI VARIABILE.
 *
 * `letturaServer` risponde alla domanda «cosa ha il server adesso»;
 * `nelPacchettoDelBrowser` alla domanda «cosa e' finito dentro il pacchetto che
 * gira nel browser». Sono due domande diverse e per le `NEXT_PUBLIC_*` quella
 * che conta e' la seconda: il cliente vede il riquadro anti-robot o il pulsante
 * della carta in base a quella, non in base all'ambiente del server.
 *
 * IL PUNTO CHE IMPEDISCE ALLA MALATTIA DI TORNARE: se una `NEXT_PUBLIC_*` finisce
 * fra le attese ma nessuno ha messo la sua lettura statica nel pacchetto, qui
 * NON si ripiega sull'ambiente del server — si risponde `non_misurabile`, e il
 * semaforo smette di essere verde finche' qualcuno non la misura davvero.
 * Ripiegare sarebbe stato comodo e avrebbe rifatto lo stesso identico buco, in
 * silenzio, alla prossima variabile pubblica che qualcuno aggiunge.
 */
export function misuraVariabili(
  attese: readonly string[],
  letturaServer: (nome: string) => string | undefined,
  nelPacchettoDelBrowser: Readonly<Record<string, string | undefined>>,
): Record<string, Misura> {
  const misure: Record<string, Misura> = {};
  for (const nome of attese) {
    if (nome.startsWith(PREFISSO_BROWSER)) {
      misure[nome] = !(nome in nelPacchettoDelBrowser)
        ? 'non_misurabile'
        : valorePresente(nelPacchettoDelBrowser[nome])
          ? 'presente'
          : 'assente';
      continue;
    }
    misure[nome] = valorePresente(letturaServer(nome)) ? 'presente' : 'assente';
  }
  return misure;
}

/**
 * IL VERDETTO.
 *
 * L'ordine delle lamentele non e' alfabetico, e' di gravita': chi legge alle tre
 * di notte deve trovare per prima la cosa che sta rompendo il sito adesso.
 *
 *   coppia_rotta  → un pezzo di marketplace e' spento MENTRE sembra configurato.
 *                   E' il caso peggiore: si guarda per ultimo perche' non si
 *                   sospetta. Va nominato per primo.
 *   mancanti      → manca un pezzo, e lo sappiamo per certo.
 *   non_misurate  → non si e' potuto guardare. Si sveglia chi rimette a posto la
 *                   misura, non chi ripara il sito: sono due mestieri diversi.
 *
 * Un elenco di attese vuoto vale come «non ho guardato niente»: e' un verde su
 * zero, il modo piu' silenzioso di sbagliare. Stessa scelta gia' fatta per i
 * battiti dei lavori periodici.
 */
export function esitoVariabili(
  misure: Readonly<Record<string, Misura>>,
  attese: readonly string[],
  coppie: readonly Coppia[] = COPPIE_INTERE_O_GUASTO,
): EsitoVariabili {
  // Una variabile attesa di cui non arriva nessuna misura non e' «a posto»:
  // e' una che nessuno ha guardato. Il ripiego prudente e' l'unico onesto.
  const misuraDi = (nome: string): Misura => misure[nome] ?? 'non_misurabile';

  const mancanti = attese.filter((n) => misuraDi(n) === 'assente');
  const nonMisurate = attese.filter((n) => misuraDi(n) === 'non_misurabile');

  // Una coppia e' rotta quando una meta' c'e' e l'altra no. Se una meta' non si
  // e' potuta misurare, la coppia non si giudica: la cecita' e' gia' detta
  // sopra, e inventare qui un guasto che non si e' visto sarebbe l'errore
  // opposto — un rosso finto, che si impara a ignorare come un verde finto.
  const coppieRotte = coppie.filter((c) => {
    const dentro = c.variabili.filter((n) => attese.includes(n));
    if (dentro.length < 2) return false;
    if (dentro.some((n) => misuraDi(n) === 'non_misurabile')) return false;
    return (
      dentro.some((n) => misuraDi(n) === 'presente') && dentro.some((n) => misuraDi(n) === 'assente')
    );
  });

  const lamentele: string[] = [];
  for (const c of coppieRotte) {
    const cheCe = c.variabili.filter((n) => misuraDi(n) === 'presente');
    const cheManca = c.variabili.filter((n) => misuraDi(n) === 'assente');
    lamentele.push(
      `${c.nome} a meta': c'e' ${cheCe.join(', ')} ma manca ${cheManca.join(', ')} → ${c.rompe}`,
    );
  }
  // Chi e' gia' stato nominato dentro una coppia non si ripete: la riga la legge
  // una persona di fretta, e due elenchi che si sovrappongono la fanno contare
  // male. Lo stesso accorgimento c'e' gia' sui battiti.
  const giaDetti = new Set(coppieRotte.flatMap((c) => [...c.variabili]));
  const mancantiNonDetti = mancanti.filter((n) => !giaDetti.has(n));
  if (mancantiNonDetti.length > 0) lamentele.push(`mancano: ${mancantiNonDetti.join(', ')}`);
  if (nonMisurate.length > 0) lamentele.push(`non misurate: ${nonMisurate.join(', ')}`);
  if (attese.length === 0) lamentele.push('nessuna variabile da guardare: l elenco e vuoto');

  const stato: StatoVariabili =
    attese.length === 0
      ? 'non_misurate'
      : coppieRotte.length > 0
        ? 'coppia_rotta'
        : mancanti.length > 0
          ? 'mancanti'
          : nonMisurate.length > 0
            ? 'non_misurate'
            : 'ok';

  return {
    ok: stato === 'ok',
    stato,
    esaminate: attese.length - nonMisurate.length,
    attese: attese.length,
    error: lamentele.length > 0 ? lamentele.join('; ') : undefined,
  };
}
