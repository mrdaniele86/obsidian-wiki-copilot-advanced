# Ricerca web SerpApi con provider selezionato nelle impostazioni

## Obiettivo

Rendere la ricerca web utilizzabile anche senza billing Gemini integrando SerpApi come provider Google-like principale. Il pulsante **Web** resta unico; il provider viene scelto soltanto nelle impostazioni.

Gemini grounding resta disponibile per gli utenti con quota o billing compatibile. SerpApi e Gemini non vengono combinati nella stessa ricerca.

## Modalità di ricerca

Le uniche modalità selezionabili sono:

- `disabled`;
- `serpapi`;
- `dedicated-gemini`.

La configurazione legacy `current-provider` continua a normalizzarsi a `disabled`. Una modalità non supportata non può avviare una richiesta né riusare credenziali di un altro provider.

## Flusso SerpApi

1. L'utente scrive una domanda e preme l'unico pulsante Web.
2. Il consenso mostra che la domanda va a SerpApi e che domanda più risultati web vanno al provider/modello chat configurato.
3. SerpApi riceve soltanto la domanda, usando Google Search e lingua/paese appropriati all'interfaccia quando disponibili.
4. L'adapter conserva fino a dieci risultati organici HTTPS, deduplicati, con titolo, URL e snippet limitati.
5. Il plugin invia al modello chat configurato un prompt delimitato contenente domanda e risultati SerpApi. Non esegue retrieval Vault.
6. La risposta viene mostrata e salvata con fonti web SerpApi separate dalle fonti Vault.

Il provider chat è usato solo per sintetizzare i risultati SerpApi e non riceve mai la chiave SerpApi. SerpApi non riceve Vault, nota attiva, cronologia, risultati Vault o chiavi di altri provider.

## Consenso e contesto

Il consenso è distinto per provider e modello chat. Per SerpApi dichiara sempre i due invii: domanda a SerpApi; domanda e risultati SerpApi al provider chat.

Il contesto recente chat resta disabilitato di default. Se l'utente lo attiva, al massimo sei turni recenti e 6.000 caratteri sono inviati solo al provider chat dopo consenso esplicito per quella variante. SerpApi riceve comunque soltanto la domanda. Il consenso ottenuto senza contesto non autorizza l'invio del contesto.

## Chiavi e impostazioni

La chiave SerpApi è una credenziale dedicata conservata nello storage sicuro Obsidian. È distinta dalla chiave Gemini Web e dalla chiave del modello chat.

Le impostazioni spiegano che SerpApi offre attualmente un piano gratuito con 250 ricerche al mese; il testo non garantisce disponibilità o quota, che dipendono dall'account SerpApi.

## Risultati persistiti

`WebSearchResult` identifica esplicitamente il provider `serpapi` o `gemini`. I record SerpApi salvano domanda, modello chat usato, risposta e da una a dieci fonti HTTPS valide. I parser trattano i metadati come input non fidato: un blocco web non valido viene scartato senza perdere il turno assistente o le fonti Vault.

## Errori e ciclo di vita

SerpApi espone errori tipizzati per chiave rifiutata, quota esaurita, risposta malformata, assenza di risultati e rete. Gli errori del modello chat durante la sintesi restano distinguibili dagli errori SerpApi.

Stop, nuova conversazione, nuova ricerca e chiusura della vista annullano entrambe le fasi del flusso SerpApi. Una ricerca annullata non aggiunge né salva turni o fonti web.

## Vincoli invariati

- Il normale pulsante Invia e la ricerca Vault restano identici.
- Il pulsante Web è uno solo e non presenta una scelta provider al momento dell'uso.
- Nessuna nota Vault, nota attiva o cronologia completa è inviata alla ricerca web.
- Non sono introdotti Brave o altri provider SERP in questa iterazione.
- Nessuna chiave viene riutilizzata fra SerpApi, Gemini Web e provider chat.
