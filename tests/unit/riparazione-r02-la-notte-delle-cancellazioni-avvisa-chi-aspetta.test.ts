/**
 * R02-004 — CHI ASPETTA LA CANCELLAZIONE LO SA DAL GIRO NOTTURNO VERO.
 *
 * La parte notturna di chi-vuole-cancellarsi-trova-una-strada-che-funziona.test.ts, spostata qui
 * com'era: la notte vera (app/api/cron/process-deletions) contro il finto unico del giro notturno,
 * e le rotte dell'account solo dove la storia passa dalla notte alla pagina.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getAdminSupabase: () => {
    if (stato.senzaChiave) throw new Error("SUPABASE_SERVICE_ROLE_KEY non configurata");
    return stato.mondo.admin;
  },
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock("@/lib/account/cancellazione", () => ({
  cancellaAccount: async (_a: unknown, userId: string): Promise<Esito> =>
    stato.esiti[userId] ?? { ok: true, fileRimossi: 0, erroriFile: [] },
}));
// 27/10/2026 (secondo giro) — IL CONTROLLO D'ACCESSO È QUELLO VERO.
// Qui c'era un withAuth finto che chiamava la rotta e basta: saltava
// authenticate(), cioè proprio il punto in cui, senza chiave di servizio, la
// risposta era «Auth non configurato». La prova era verde su un ramo che in
// produzione non si eseguiva mai. Adesso si finge solo il servizio di accesso
// di Supabase (di chi è il gettone); withAuth, withAuthRateLimit e
// withCronAuth sono quelli di lib/api/middleware.ts.
vi.mock("@/lib/supabase/anonimo", () => ({
  creaClientAnonimo: () => ({
    auth: { getUser: async () => ({ data: { user: UTENTE }, error: null }) },
  }),
}));
vi.mock("@/lib/captcha", () => ({ verifyTurnstileToken: async () => ({ ok: true }) }));
vi.mock("@/lib/email/client", () => ({ sendEmail: (x: unknown) => inviaEmail(x) }));

import { fintoGiroNotturno } from "./aiuti/finto-giro-notturno";
import { UTENTE, SECONDO, INDIRIZZI, stato, GUASTO, inviaEmail, CTX, GIORNO, giorniFa, CHIESTA, CASSA_APERTA, ilFattorinoConLaCassaAperta, unGiro, passaLaNotte, conGettone, lettereA, suoi, corpo, richiestaAlModulo, letto, GIU, SU, preparaLaProva, type Esito } from "./aiuti/riparazione-r02-giro-cancellazioni-di-prova";
import { GET as statoCancellazione } from "@/app/api/account/delete/route";
import { POST as scriviAiContatti } from "@/app/api/contact/route";

beforeEach(preparaLaProva);

afterEach(() => {
  vi.useRealTimers();
});

describe("chi aspetta la cancellazione lo sa dal giro notturno vero", () => {
  it("dopo la notte il fattorino ha nel suo pannello il motivo del rinvio", async () => {
    ilFattorinoConLaCassaAperta();
    const res = await passaLaNotte();
    expect(
      suoi(),
      "il giro ha calcolato la spiegazione dovuta (art. 12.4) e non l ha scritta a nessuno",
    ).toHaveLength(1);
    expect(String(suoi()[0].body)).toContain("120,00 €");
    expect(String(suoi()[0].body)).toContain("Garante");
    // Senza casella vera la frase non diventa «scrivi a il modulo dei contatti».
    expect(String(suoi()[0].body)).not.toContain("scrivi a il modulo");
    // La stessa spiegazione gli arriva per email: il pannello è di un sito da
    // cui sta cercando di andarsene, e non è detto che ci rientri.
    const lettere = lettereA(UTENTE.email);
    expect(lettere, "il motivo restava solo dentro il sito").toHaveLength(1);
    expect(String(lettere[0].html)).toContain("120,00");
    // Un rinvio deciso da noi non è un guasto: la notte resta verde.
    expect(res.status).toBe(200);
  });

  it("trenta notti non sono trenta messaggi: la seconda notte non riscrive", async () => {
    ilFattorinoConLaCassaAperta();
    // 27/10/2026 (terzo giro) — Qui la posta era spenta, e la prova chiedeva
    // UNA email dopo due notti: blindava proprio il difetto, la spiegazione
    // non partita la prima notte che non ripartiva mai. Una email sola si
    // chiede quando la prima È PARTITA; quella che non parte si riprova (vedi
    // «la spiegazione per email che non parte si riprova», qui sotto).
    inviaEmail.mockImplementation(async () => ({ ok: true }));
    await passaLaNotte();
    await passaLaNotte();
    expect(suoi()).toHaveLength(1);
    expect(lettereA(UTENTE.email), "trenta notti non sono trenta email").toHaveLength(1);
  });

  it("la pagina del suo account restituisce lo stesso motivo", async () => {
    ilFattorinoConLaCassaAperta();
    await passaLaNotte();
    const body = (await (await statoCancellazione(conGettone("GET", "/api/account/delete") as never, CTX)).json()) as Record<string, unknown>;
    expect(body.pending).toBe(true);
    expect(
      String(body.motivo ?? ""),
      "il conto alla rovescia fermo a zero era l unica cosa che vedeva",
    ).toContain("120,00 €");
    expect(body.rinviata, "la pagina deve sapere che il conto alla rovescia non vale più").toBe(true);
  });

  it("chi non ha nessun rinvio non riceve un motivo inventato", async () => {
    ilFattorinoConLaCassaAperta();
    const body = (await (await statoCancellazione(conGettone("GET", "/api/account/delete") as never, CTX)).json()) as Record<string, unknown>;
    expect(body.pending).toBe(true);
    expect(body.motivo ?? null).toBeNull();
    expect(body.rinviata, "nessun rinvio: il conto alla rovescia resta quello vero").toBe(false);
  });
});

/**
 * 27/10/2026 — Il collaudo ha trovato tre modi di sbagliare che nessuna prova
 * vedeva: il modulo che dice «ok» con la mail ferma, la notte verde con un
 * avviso dovuto per legge non partito, l'avviso di termine scaduto perso per
 * strada. Ognuna di queste prove diventa rossa su uno di quei tre sbagli.
 */
describe("un messaggio dovuto che non parte non passa per partito", () => {
  const messaggio = (ip: string) =>
    new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ name: "Maria Rossi", email: "maria@example.com", subject: "Privacy", message: "Vorrei cancellare il mio account, grazie." }),
    });

  it("il modulo non dice ok se la mail al supporto non è partita", async () => {
    stato.senzaChiave = true;
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    inviaEmail.mockResolvedValueOnce({ ok: false, skipped: true, reason: "non configurata" } as { ok: boolean });
    const res = await scriviAiContatti(messaggio("7.0.0.3"));
    expect(inviaEmail).toHaveBeenCalledTimes(1);
    expect(res.status, "Maria legge «inviato» e il suo messaggio non arriva a nessuno").toBe(503);
    expect(await corpo(res)).toContain("non è arrivato");
  });

  it("il modulo non dice ok se la mail al supporto lancia", async () => {
    stato.senzaChiave = true;
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    inviaEmail.mockRejectedValueOnce(new Error("rete giù"));
    const res = await scriviAiContatti(messaggio("7.0.0.4"));
    expect(res.status).toBe(503);
  });

  it("se il motivo dell'attesa non si scrive, la notte è rossa e un amministratore lo sa", async () => {
    ilFattorinoConLaCassaAperta();
    stato.mondo.guasti.push(GUASTO.avvisiA("rider-1"));
    const res = await passaLaNotte();
    const body = (await (res as Response).json()) as Record<string, unknown>;
    expect(body.avvisiFalliti).toBe(1);
    expect(res.status, "un avviso dovuto per legge non partito è un guasto, non una notte verde").toBe(500);
    const allarmi = stato.mondo.righe("notifications").filter((n) => n.user_id === "admin-1");
    expect(allarmi.map((n) => n.title)).toContain("Persone non avvisate del rinvio della cancellazione");
  });

  it("oltre il mese il fattorino riceve anche l'avviso del termine scaduto", async () => {
    ilFattorinoConLaCassaAperta(giorniFa(40));
    await passaLaNotte();
    const titoli = suoi().map((n) => n.title);
    expect(titoli).toContain("La tua richiesta di cancellazione è in attesa");
    expect(titoli, "il termine di legge è passato e lui non lo sa").toContain("La tua cancellazione è in ritardo");
  });

  it("oltre il mese, anche con un guasto nostro, la persona sa del ritardo", async () => {
    ilFattorinoConLaCassaAperta(giorniFa(40), { ok: false, errore: "timeout", fileRimossi: 0, erroriFile: [] });
    await passaLaNotte();
    expect(suoi().map((n) => n.title)).toEqual(["La tua cancellazione è in ritardo"]);
  });
});

describe("la spiegazione per email che non parte si riprova, e se non parte ancora qualcuno lo sa", () => {
  it("IL CASO CHE ROMPEVA — Resend dice di no la prima notte: la notte dopo la spiegazione parte", async () => {
    ilFattorinoConLaCassaAperta();
    inviaEmail.mockImplementation(async () => ({ ok: false, error: "Resend 503" }) as { ok: boolean });
    const prima = await passaLaNotte();
    expect(prima.status, "un intoppo di una notte non è ancora un guasto: la notte dopo si riprova").toBe(200);
    expect(stato.mondo.notifiche(), "si sveglia qualcuno per un intoppo che si sistema da solo").toHaveLength(0);

    inviaEmail.mockImplementation(async () => ({ ok: true }));
    const seconda = await passaLaNotte();
    expect(
      lettereA(UTENTE.email),
      "la spiegazione non partita la prima notte non riparte mai: l'avviso risulta «già detto»",
    ).toHaveLength(2);
    expect(seconda.status).toBe(200);

    await passaLaNotte();
    await passaLaNotte();
    expect(lettereA(UTENTE.email), "partita una volta, non si rimanda").toHaveLength(2);
    expect(suoi(), "il pannello resta con un avviso solo").toHaveLength(1);
  });

  it("IL CASO CHE ROMPEVA — se la posta dice di no anche la notte dopo, la notte è rossa e un amministratore lo sa", async () => {
    ilFattorinoConLaCassaAperta();
    const prima = await passaLaNotte();
    expect(prima.status).toBe(200);
    const seconda = await passaLaNotte();
    const body = (await (seconda as Response).json()) as Record<string, unknown>;

    expect(lettereA(UTENTE.email), "la seconda notte la spiegazione si riprova").toHaveLength(2);
    expect(body.avvisiEmailBloccate, "quante spiegazioni restano ferme la risposta non lo dice").toBe(1);
    expect(seconda.status, "la spiegazione non parte da due notti e la notte resta verde").toBe(500);
    const allarmi = stato.mondo.notifiche();
    expect(allarmi, "nessun amministratore sa che la persona non ha ricevuto niente per email").toHaveLength(1);
    expect(String(allarmi[0].title)).toContain("email");
    expect(String(allarmi[0].body)).toContain("scrivile tu");
  });

  it("se il registro degli invii non si legge, non si spedisce alla cieca e un amministratore lo sa subito", async () => {
    ilFattorinoConLaCassaAperta();
    stato.mondo.guasti.push(...GUASTO.registroInvii);
    inviaEmail.mockImplementation(async () => ({ ok: true }));
    const res = await passaLaNotte();
    const body = (await (res as Response).json()) as Record<string, unknown>;

    expect(suoi(), "il pannello non dipende dal registro delle email").toHaveLength(1);
    expect(lettereA(UTENTE.email), "senza registro ogni notte partirebbe una email in più").toHaveLength(0);
    expect(body.avvisiEmailBloccate).toBe(1);
    expect(res.status).toBe(500);
    expect(stato.mondo.notifiche()).toHaveLength(1);
  });

  // 27/10/2026 (sesto giro) — UN TURNO RIFIUTATO NON È UN TURNO PRESO DA ALTRI.
  // La prova di sopra rompe il registro già alla lettura, quindi il rifiuto
  // della riga del turno non lo raggiungeva nessuna prova. Il collaudo l'ha
  // mostrato: trattare OGNI rifiuto come «in corso» (un altro giro spedisce
  // lui) lasciava tutto verde, mentre non spediva nessuno — niente email,
  // nessun allarme, una notte verde dopo l'altra. Solo il doppione vuol dire
  // «in corso»; ogni altro no ferma l'email e sveglia qualcuno.
  it("se il registro si legge ma rifiuta il turno dell'email, e non è un doppione, la notte è rossa e un amministratore lo sa", async () => {
    ilFattorinoConLaCassaAperta();
    stato.mondo.guasti.push(GUASTO.registroRifiutaLeRighe);
    inviaEmail.mockImplementation(async () => ({ ok: true }));
    const stati: number[] = [];
    const bloccate: unknown[] = [];
    for (let n = 1; n <= 2; n++) {
      const res = await passaLaNotte();
      stati.push(res.status);
      bloccate.push(((await (res as Response).json()) as Record<string, unknown>).avvisiEmailBloccate);
    }

    expect(suoi(), "il pannello non dipende dal registro delle email").toHaveLength(1);
    expect(lettereA(UTENTE.email), "senza la riga del turno ogni notte partirebbe una email in più").toHaveLength(0);
    expect(bloccate, "un turno rifiutato passa per un turno in volo: nessuno lo conta").toEqual([1, 1]);
    expect(stati, "rossa la notte in cui l'email si ferma, verde le notti dopo l'allarme").toEqual([500, 200]);
    const allarmi = stato.mondo.notifiche();
    expect(allarmi, "nessun amministratore sa che la persona non riceve niente per email").toHaveLength(1);
    expect(String(allarmi[0].title)).toContain("email");
  });
});

describe("oltre il mese la rotta dell'account dice il ritardo, non un conto alla rovescia", () => {
  it("con un guasto nostro: rinviata e il motivo del termine scaduto", async () => {
    ilFattorinoConLaCassaAperta(giorniFa(40), { ok: false, errore: "timeout", fileRimossi: 0, erroriFile: [] });
    await passaLaNotte();
    const body = await letto(await statoCancellazione(conGettone("GET", "/api/account/delete") as never, CTX));
    expect(body.pending).toBe(true);
    expect(body.rinviata, "oltre il mese la cancellazione è ferma: «tra 0 giorni» non vale").toBe(true);
    expect(String(body.motivo ?? ""), "il termine di legge è passato e la rotta non lo dice").toContain("quel mese è passato");
  });

  it("con la cassa aperta: il ritardo vince sul rinvio, e la rotta dice il ritardo", async () => {
    ilFattorinoConLaCassaAperta(giorniFa(40));
    await passaLaNotte();
    const body = await letto(await statoCancellazione(conGettone("GET", "/api/account/delete") as never, CTX));
    expect(body.rinviata).toBe(true);
    expect(String(body.motivo ?? "")).toContain("quel mese è passato");
  });
});

describe("la spiegazione per email si ritenta ogni notte, senza tetto e senza doppioni", () => {
  it("la risposta della notte dice quante spiegazioni non sono uscite per email", async () => {
    ilFattorinoConLaCassaAperta();
    const body = await letto(await passaLaNotte());
    expect(body.avvisiEmailNonPartite, "posta spenta: la spiegazione è nel pannello e non è uscita").toBe(1);
    expect(body.avvisiEmailBloccate, "una notte sola è un intoppo, non ancora un guasto").toBe(0);
  });

  it("tre notti di posta giù e poi su: la spiegazione parte la quarta notte", async () => {
    ilFattorinoConLaCassaAperta();
    inviaEmail.mockImplementation(async () => ({ ok: false, error: "Resend 503" }) as { ok: boolean });
    await passaLaNotte();
    await passaLaNotte();
    await passaLaNotte();
    expect(lettereA(UTENTE.email), "una prova a notte, tutte e tre").toHaveLength(3);

    inviaEmail.mockImplementation(async () => ({ ok: true }));
    const quarta = await passaLaNotte();
    const body = await letto(quarta);
    expect(lettereA(UTENTE.email), "la posta è tornata e la spiegazione non è ripartita: un tetto ai tentativi").toHaveLength(4);
    expect(body.avvisiEmailBloccate).toBe(0);
    expect(quarta.status).toBe(200);

    await passaLaNotte();
    expect(lettereA(UTENTE.email), "partita una volta, non si rimanda").toHaveLength(4);
  });

  it("IL CASO CHE ROMPEVA — un secondo giro parte mentre il primo sta ancora spedendo: una email, nessun falso allarme", async () => {
    ilFattorinoConLaCassaAperta();
    let rilascia: (v: { ok: boolean }) => void = () => {};
    let fermo = false;
    inviaEmail.mockImplementation(async (x: unknown) => {
      if ((x as { to?: string }).to === UTENTE.email && !fermo) {
        fermo = true;
        return new Promise<{ ok: boolean }>((r) => { rilascia = r; });
      }
      // Se il secondo giro provasse a spedire, la posta gli direbbe di no.
      return { ok: false, error: "Resend 503" } as { ok: boolean };
    });

    vi.setSystemTime(Date.now() + GIORNO);
    const primo = unGiro();
    for (let i = 0; i < 500 && !fermo; i++) await new Promise((r) => setTimeout(r, 0));
    expect(fermo, "il primo giro non è arrivato a spedire").toBe(true);

    // Venti minuti dopo, la stessa notte: l'altro lavoro periodico.
    vi.setSystemTime(Date.now() + 20 * 60_000);
    const secondo = await unGiro();
    const suo = await letto(secondo);
    expect(lettereA(UTENTE.email), "il secondo giro rispedisce la spiegazione che il primo sta spedendo").toHaveLength(1);
    expect(suo.avvisiEmailBloccate, "un tentativo in volo non è una email ferma").toBe(0);
    expect(secondo.status, "falso allarme la prima notte").toBe(200);
    expect(stato.mondo.notifiche(), "nessun amministratore da svegliare").toHaveLength(0);

    rilascia({ ok: true });
    expect((await primo).status).toBe(200);
    await passaLaNotte();
    expect(lettereA(UTENTE.email), "partita una volta: la notte dopo non si rimanda").toHaveLength(1);
  });

  // 27/10/2026 (quinto giro) — LA FINESTRA SI MISURA DALL'ULTIMO TENTATIVO.
  // La prova di sopra guarda una notte sola, e la prima notte il primo
  // tentativo e l'ultimo sono lo stesso: misurare dal primo restava verde. Dalla
  // seconda notte no — il primo è di ieri, e il secondo giro rispediva.
  it("IL CASO CHE ROMPEVA — due giri sfalsati ogni notte con la posta giù: una lettera per notte, anche dalla seconda in poi", async () => {
    ilFattorinoConLaCassaAperta();
    inviaEmail.mockImplementation(async () => ({ ok: false, error: "Resend 503" }) as { ok: boolean });
    const lettereDopoLaNotte: number[] = [];
    const secondiGiri: number[] = [];
    for (let n = 1; n <= 3; n++) {
      await passaLaNotte(); // il lavoro periodico di Vercel
      vi.setSystemTime(Date.now() + 20 * 60_000); // venti minuti dopo, il cron esterno
      secondiGiri.push((await unGiro()).status);
      lettereDopoLaNotte.push(lettereA(UTENTE.email).length);
    }
    expect(lettereDopoLaNotte, "il secondo giro rispedisce: la finestra è misurata dal primo tentativo, non dall'ultimo").toEqual([1, 2, 3]);
    expect(secondiGiri, "il secondo giro della notte non è una email ferma in più").toEqual([200, 200, 200]);
    expect(stato.mondo.notifiche(), "una spiegazione ferma, un allarme").toHaveLength(1);
  });

  // 27/10/2026 (quinto giro) — NIENTE TETTO, PER TUTTO IL MESE.
  // Tre notti giù non dicono niente di un tetto a cinque. Chi aspetta resta in
  // attesa fino al termine di legge (30 giorni dalla richiesta): la spiegazione
  // si ritenta ogni notte fino a lì, non per un numero di volte.
  it("venti notti di posta giù, a un passo dal termine di legge: la ventunesima la spiegazione parte ancora", async () => {
    ilFattorinoConLaCassaAperta(); // chiesta 8 giorni fa: la notte 21 è il giorno 29, dentro il mese
    inviaEmail.mockImplementation(async () => ({ ok: false, error: "Resend 503" }) as { ok: boolean });
    for (let n = 1; n <= 20; n++) await passaLaNotte();
    expect(lettereA(UTENTE.email), "una prova a notte, tutte e venti: un tetto ai tentativi").toHaveLength(20);

    inviaEmail.mockImplementation(async () => ({ ok: true }));
    const ventunesima = await passaLaNotte();
    const body = await letto(ventunesima);
    expect(body.scadute, "la prova deve restare dentro il mese").toBe(0);
    expect(lettereA(UTENTE.email), "la posta è tornata e la spiegazione non è ripartita: un tetto ai tentativi").toHaveLength(21);
    expect(body.avvisiEmailBloccate).toBe(0);
    expect(ventunesima.status).toBe(200);
  });
});

describe("con la posta spenta l'allarme suona una volta per stato, non ogni notte", () => {
  it("cinque notti di posta spenta: un allarme solo, e le notti dopo il battito si scrive", async () => {
    ilFattorinoConLaCassaAperta();
    const battiti = () =>
      stato.mondo.diario.filter((v) => {
        const voce = v as { op: string; tabella?: string };
        return (voce.op === "upsert" || voce.op === "insert") && voce.tabella === "cron_heartbeats";
      }).length;
    const stati: number[] = [];
    let ultimo: Record<string, unknown> = {};
    let battitoDellUltima = false;
    for (let n = 1; n <= 5; n++) {
      const prima = battiti();
      const res = await passaLaNotte();
      stati.push(res.status);
      ultimo = await letto(res);
      battitoDellUltima = battiti() > prima;
    }
    expect(stati, "rossa la notte in cui la spiegazione si ferma, non tutte le notti dopo").toEqual([200, 500, 200, 200, 200]);
    expect(stato.mondo.notifiche(), "un allarme nuovo, uguale al precedente, ogni notte").toHaveLength(1);
    expect(battitoDellUltima, "il lavoro è vivo: il sorvegliante non deve crederlo morto").toBe(true);
    expect(ultimo.avvisiEmailBloccate, "lo stato resta detto nella risposta").toBe(1);
    expect(lettereA(UTENTE.email), "si riprova comunque ogni notte").toHaveLength(5);
  });

  // 27/10/2026 (quinto giro) — UN ALLARME PER OGNI SPIEGAZIONE FERMA, A OGNI
  // AMMINISTRATORE. La prova di sopra ha un fattorino e un amministratore: un
  // allarme ricavato solo dall'amministratore (o solo dall'avviso) restava
  // verde. Con due persone ferme in notti diverse, la seconda spiegazione
  // ferma trovava l'allarme della prima e restava muta, con la notte verde.
  it("IL CASO CHE ROMPEVA — due fattorini fermi in notti diverse, due amministratori: ogni spiegazione ferma ha il suo allarme, per ognuno", async () => {
    ilFattorinoConLaCassaAperta();
    stato.esiti[SECONDO.id] = CASSA_APERTA;
    const inCoda = [{ user_id: UTENTE.id, deleted_at: CHIESTA }];
    stato.mondo = fintoGiroNotturno({
      indirizzi: INDIRIZZI,
      rpc: { process_expired_deletions: { data: inCoda, error: null } },
      tabelle: {
        notifications: [],
        profiles: [
          { id: UTENTE.id, role: "rider", deletion_requested_at: CHIESTA },
          { id: SECONDO.id, role: "rider", deletion_requested_at: CHIESTA },
          { id: "admin-1", role: "admin" },
          { id: "admin-2", role: "admin" },
        ],
      },
    });
    const stati: number[] = [];
    let quinta: Record<string, unknown> = {};
    for (let n = 1; n <= 5; n++) {
      // Dalla quarta notte aspetta la cancellazione anche il secondo fattorino.
      if (n === 4) inCoda.push({ user_id: SECONDO.id, deleted_at: CHIESTA });
      const res = await passaLaNotte();
      stati.push(res.status);
      quinta = await letto(res);
    }
    expect(lettereA(SECONDO.email), "anche la sua spiegazione si ritenta ogni notte").toHaveLength(2);
    expect(stati, "la seconda spiegazione ferma resta muta: la notte 5 è verde").toEqual([200, 500, 200, 200, 500]);
    expect(quinta.avvisiEmailBloccate).toBe(2);
    expect(quinta.allarmiEmailNuovi, "ferma da stanotte è la seconda, non la prima").toBe(1);
    const allarmi = stato.mondo.notifiche().filter((n) => n.title === "Spiegazione dell'attesa non partita per email");
    const di = (amministratore: string) => allarmi.filter((n) => n.user_id === amministratore).length;
    expect([di("admin-1"), di("admin-2")], "ogni amministratore sa di tutte e due").toEqual([2, 2]);
    expect(new Set(allarmi.map((n) => n.id)).size, "quattro allarmi, quattro identificativi").toBe(4);
  });
});

describe("il modulo dei contatti e l'allarme non si fanno ingannare", () => {
  it("il modulo non dice ok quando Resend risponde con un errore vero ({ ok:false, error })", async () => {
    stato.senzaChiave = true;
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    process.env.RESEND_API_KEY = "re_di_prova";
    process.env.RESEND_FROM = "MyCity <no-reply@example.com>";
    inviaEmail.mockResolvedValueOnce({ ok: false, error: "Resend 422: dominio non verificato" } as { ok: boolean });
    const res = await scriviAiContatti(richiestaAlModulo("7.0.0.21"));
    expect(inviaEmail).toHaveBeenCalledTimes(1);
    expect(res.status, "Maria legge «inviato» e Resend l'ha rifiutato").toBe(503);
  });

  it("due persone, a una il motivo non si scrive: la notte è rossa anche se all'altra è arrivato", async () => {
    ilFattorinoConLaCassaAperta();
    stato.esiti["rider-2"] = CASSA_APERTA;
    stato.mondo = fintoGiroNotturno({
      indirizzi: INDIRIZZI,
      rpc: {
        process_expired_deletions: {
          data: [{ user_id: "rider-1", deleted_at: CHIESTA }, { user_id: "rider-2", deleted_at: CHIESTA }],
          error: null,
        },
      },
      tabelle: {
        notifications: [],
        profiles: [
          { id: "rider-1", role: "rider", deletion_requested_at: CHIESTA },
          { id: "rider-2", role: "rider", deletion_requested_at: CHIESTA },
          { id: "admin-1", role: "admin" },
        ],
      },
    });
    stato.mondo.guasti.push(GUASTO.avvisiA("rider-1"));
    const res = await passaLaNotte();
    const body = await letto(res);
    expect([body.avvisiRecapitati, body.avvisiFalliti]).toEqual([1, 1]);
    expect(res.status, "uno recapitato non compensa uno non partito").toBe(500);
    expect(stato.mondo.notifiche().map((n) => n.title)).toContain("Persone non avvisate del rinvio della cancellazione");
  });
});

describe("un allarme che non si riesce a scrivere non fa tornare verde la notte", () => {
  it("la spiegazione è ferma e il database rifiuta l'allarme: la notte resta rossa finché qualcuno lo sa", async () => {
    ilFattorinoConLaCassaAperta();
    stato.mondo.guasti.push(GUASTO.avvisiA("admin-1"));
    const stati: number[] = [];
    for (let n = 1; n <= 3; n++) stati.push((await passaLaNotte()).status);
    expect(stati, "un allarme per stato vale solo se lo stato è stato detto a qualcuno").toEqual([200, 500, 500]);
    expect(stato.mondo.notifiche()).toHaveLength(0);
  });
});

describe("il ritentativo dell'email regge le notti vere, non solo quelle di ventiquattro ore", () => {
  // Mutazione: ORE_TRA_DUE_TENTATIVI da 20 a 24.
  it("il giro che arriva dieci minuti prima dell'ora di ieri riprova lo stesso", async () => {
    ilFattorinoConLaCassaAperta();
    inviaEmail.mockImplementation(GIU);
    await passaLaNotte();
    expect(lettereA(UTENTE.email)).toHaveLength(1);
    vi.setSystemTime(Date.now() + GIORNO - 10 * 60_000);
    await unGiro();
    expect(lettereA(UTENTE.email), "Vercel garantisce l'ora, non il minuto: la notte dopo deve riprovare").toHaveLength(2);
  });

  // Mutazione: un tetto ai tentativi (qui a 25). Il mese di legge è di trenta giorni.
  it("trenta notti, il mese di legge intero: ventinove di posta giù, la trentesima la spiegazione parte", async () => {
    ilFattorinoConLaCassaAperta(giorniFa(0));
    inviaEmail.mockImplementation(GIU);
    for (let n = 1; n <= 29; n++) await passaLaNotte();
    const oggetto = lettereA(UTENTE.email)[0]?.subject;
    const delRinvio = () => lettereA(UTENTE.email).filter((l) => l.subject === oggetto);
    expect(delRinvio(), "una prova a notte, tutte e ventinove: un tetto ai tentativi").toHaveLength(29);
    inviaEmail.mockImplementation(SU);
    await passaLaNotte();
    expect(delRinvio(), "la posta è tornata e la spiegazione non è ripartita").toHaveLength(30);
  });

  // Mutazione: `|| presi.length > 0` accanto al doppione → un rifiuto vero passa per «in corso».
  it("prima notte posta giù, seconda notte il registro rifiuta il turno (non doppione): la notte è rossa e un amministratore lo sa", async () => {
    ilFattorinoConLaCassaAperta();
    inviaEmail.mockImplementation(GIU);
    expect((await passaLaNotte()).status).toBe(200);
    stato.mondo.guasti.push(GUASTO.registroRifiutaLeRighe);
    inviaEmail.mockImplementation(SU);
    const seconda = await passaLaNotte();
    const body = await letto(seconda);
    expect(body.avvisiEmailBloccate, "il turno rifiutato dopo un tentativo già preso passa per un turno in volo").toBe(1);
    expect(seconda.status).toBe(500);
    expect(lettereA(UTENTE.email), "senza la riga del turno non si spedisce").toHaveLength(1);
    expect(stato.mondo.notifiche()).toHaveLength(1);
  });
});

describe("se la lettura dell'allarme già scritto non riesce, la notte resta rossa", () => {
  // Mutazione: togliere `rotto = true` quando la lettura dell'allarme fallisce.
  it("l'email è ferma e non si riesce a sapere se l'allarme c'è: rossa, notte dopo notte", async () => {
    ilFattorinoConLaCassaAperta();
    await passaLaNotte();
    const { identificativoAvviso } = await import("@/lib/privacy/avvisi-a-chi-aspetta");
    stato.mondo.guasti.push(GUASTO.letturaDi(identificativoAvviso(`${suoi()[0].id}:email-ferma:admin-1`)));
    const stati: number[] = [];
    for (let n = 2; n <= 3; n++) stati.push((await passaLaNotte()).status);
    expect(stati, "nessuno sa che la spiegazione è ferma, e la notte è verde").toEqual([500, 500]);
    expect(stato.mondo.notifiche()).toHaveLength(0);
  });
});

describe("i minori nati nel quarto giro", () => {
  it("la lettura del registro degli invii guarda solo le righe delle notifiche (target_table)", async () => {
    ilFattorinoConLaCassaAperta();
    inviaEmail.mockImplementation(GIU);
    await passaLaNotte();
    // Una riga di un'altra tabella con lo stesso identificativo: non è l'email di questo avviso.
    stato.mondo.righe("audit_logs").push({
      id: "riga-di-un-altra-tabella",
      action: "privacy.avviso_cancellazione.email_partita",
      target_table: "orders",
      target_id: suoi()[0].id,
      metadata: {},
    });
    inviaEmail.mockImplementation(SU);
    await passaLaNotte();
    expect(lettereA(UTENTE.email), "una riga di un'altra tabella ha fermato l'email").toHaveLength(2);
  });

  it("la sveglia per le cancellazioni ferme parte prima delle email: se la posta si appende, la sveglia c'è già", async () => {
    ilFattorinoConLaCassaAperta(giorniFa(40));
    const svegliaGiaScritta: boolean[] = [];
    inviaEmail.mockImplementation(async () => {
      svegliaGiaScritta.push(stato.mondo.notifiche().length > 0);
      return { ok: true };
    });
    const res = await passaLaNotte();
    expect(res.status, "oltre il mese la notte sveglia qualcuno").toBe(500);
    expect(svegliaGiaScritta.length).toBeGreaterThan(0);
    expect(svegliaGiaScritta[0], "le email partivano prima della sveglia").toBe(true);
  });

  it("un giro rifatto a mano poche ore dopo non spedisce, e la risposta lo dice invece di sembrare tutto partito", async () => {
    ilFattorinoConLaCassaAperta();
    inviaEmail.mockImplementation(GIU);
    await passaLaNotte();
    await passaLaNotte();
    inviaEmail.mockImplementation(SU);
    vi.setSystemTime(Date.now() + 6 * 3_600_000);
    const body = await letto(await unGiro());
    expect(lettereA(UTENTE.email), "il turno di stanotte è già preso").toHaveLength(2);
    expect(body.avvisiEmailRimandate, "0 non partite e 0 ferme: sembra tutto partito").toBe(1);
  });

  it("l'allarme dice chi è la persona, e si chiude la notte in cui l'email parte", async () => {
    ilFattorinoConLaCassaAperta();
    await passaLaNotte();
    await passaLaNotte();
    const [allarme] = stato.mondo.notifiche();
    expect(String(allarme?.body ?? ""), "«scrivile tu», ma a chi?").toContain(UTENTE.id);
    expect(allarme?.is_read ?? false).toBe(false);
    inviaEmail.mockImplementation(SU);
    await passaLaNotte();
    expect(lettereA(UTENTE.email)).toHaveLength(3);
    expect(stato.mondo.notifiche()[0]?.is_read, "l'email è partita e l'allarme chiede ancora di scriverle").toBe(true);
  });
});
