# Ricerca web opzionale con provider configurabile

## Obiettivo

Consentire a Wiki Copilot Advanced di cercare informazioni aggiornate sul web solo con consenso esplicito dell'utente. Le risposte devono mantenere chiaramente separate le fonti online dalle fonti del Vault.

La ricerca web è complementare alla ricerca locale: non cambia l'indice, le note, il recupero o le citazioni del Vault esistenti.

## Non obiettivi

- Non rendere la ricerca web obbligatoria o attiva per impostazione predefinita.
- Non inviare automaticamente l'intero Vault, conversazioni precedenti o chiavi API tra provider.
- Non fingere supporto web per un endpoint o modello che non lo espone realmente.
- Non mescolare URL web con le citazioni `S1`, `S2` delle note del Vault.
- Non implementare un motore di ricerca proprietario o una raccolta diretta di pagine web dal plugin.

## Configurazione

Nelle impostazioni viene introdotta la sezione **Ricerca online** con le seguenti modalità:

| Modalità | Comportamento |
| --- | --- |
| Disattivata | Solo ricerca nel Vault; impostazione predefinita. |
| Usa provider attuale | Usa l'attuale provider/modello solo se l'adapter ne dichiara il supporto web. |
| Provider dedicato | Configura indipendentemente provider, modello e chiave API per la ricerca online. |

La modalità dedicata presenta adapter espliciti, non una casella generica OpenAI-compatible:

- **Gemini con Google Search grounding** come primo adapter supportato;
- **xAI/Grok** come futuro adapter, quando il modello e l'API configurati supportano la ricerca;
- altri provider solo dopo un adapter verificato e testato.

Ogni adapter espone le proprie capacità. Se il provider corrente è locale, OpenAI-compatible generico o non supportato, l'interfaccia disabilita l'opzione “Usa provider attuale” e spiega che non può eseguire ricerche web.

Le credenziali del provider dedicato sono conservate nello stesso archivio sicuro di Obsidian già usato per le chiavi API del modello. Non vengono copiate né riutilizzate implicitamente fra provider.

## Consenso e privacy

Prima di ogni ricerca online il plugin mostra una conferma localizzata che indica:

- provider scelto e modello;
- che la domanda uscirà dal Vault e sarà inviata al provider;
- che i risultati web e le fonti saranno mostrati nella conversazione;
- eventuali condizioni note dell'adapter, come conservazione dati dichiarata dal provider.

Il consenso offre **Cerca ora**, **Annulla** e **Ricorda per questa sessione**. Non viene ricordato oltre la sessione di Obsidian. La scelta “Annulla” lascia la domanda nel composer e non invia alcuna richiesta esterna.

Per impostazione predefinita la ricerca online invia soltanto la domanda esplicita dell'utente e istruzioni minime del plugin. Non invia passaggi del Vault o note attive.

Una nuova opzione, **Includi contesto recente della chat**, è disattivata per impostazione predefinita. Quando è attiva, il plugin prepara un contesto limitato ai turni più recenti e pertinenti della conversazione, con limiti rigidi di turni e caratteri. Il consenso indica esplicitamente che anche questo breve contesto sarà inviato al provider e permette di annullare prima di ogni richiesta. Non viene mai inviata l'intera cronologia né contenuto del Vault non già scritto dall'utente o dal modello nella conversazione.

## Flusso della domanda

1. L'utente invia una domanda normale al plugin.
2. Se la ricerca online è disattivata, il flusso locale attuale rimane invariato.
3. Se è abilitata, l'interfaccia rende disponibile un'azione esplicita “Cerca sul web”; il plugin non decide autonomamente di inviare domande fuori dal Vault.
4. L'utente conferma la richiesta, salvo consenso già ricordato per la sessione.
5. L'adapter selezionato esegue la ricerca con lo strumento web nativo del provider.
6. Il plugin riceve testo e metadati strutturati delle fonti web, compresi titoli e URL.
7. La risposta viene visualizzata come risposta web, con fonti web separate e link apribili.

La ricerca web manuale non cambia il significato delle risposte locali: una risposta generata dal solo Vault continua a basarsi sul Vault; una risposta web dichiara il provider e le fonti esterne usate.

## Fonti e presentazione

- Le fonti del Vault mantengono i marcatori `S1`, `S2` e il comportamento corrente di apertura delle citazioni.
- Le fonti web sono visualizzate in un blocco distinto con nome, URL e provider.
- I metadati di grounding del provider vengono conservati nella conversazione, affinché una chat riaperta mantenga le fonti web mostrate originariamente.
- Il plugin non trasforma gli URL web in wikilink né cerca di aprirli come file del Vault.

## Adapter Gemini

Il primo adapter dedicato usa la Gemini API con lo strumento nativo `google_search` (Google Search grounding). L'adapter:

- richiede chiave Gemini separata, modello compatibile e consenso utente;
- invia la domanda tramite l'API Gemini, non tramite l'endpoint OpenAI-compatible esistente;
- legge i metadati di grounding per associare testo, URL e titolo delle fonti;
- distingue mancanza di quota, modello non compatibile, chiave mancante e risposta senza fonti;
- mostra nell'avviso di consenso le condizioni sulla condivisione del prompt conosciute dal provider.

Le quote e i prezzi restano sotto il controllo dell'account Google dell'utente e possono cambiare; il plugin non promette che la ricerca web sia gratuita.

## Errori e fallback

- Configurazione assente o modello non compatibile: indicazione localizzata, nessuna richiesta inviata.
- Consenso rifiutato: nessuna richiesta online e domanda mantenuta per l'utente.
- Errore, quota esaurita o timeout del provider: risposta di errore localizzata con possibilità di riprovare; nessuna falsa risposta locale.
- Nessun risultato web utile: messaggio trasparente e fonti eventualmente restituite dal provider.
- La ricerca locale non viene avviata come fallback nascosto di una ricerca web fallita, né viceversa: l'origine della risposta deve restare chiara.

## Test futuri

- Test di impostazioni: disattivata, provider corrente compatibile/non compatibile e provider dedicato.
- Test del consenso: annulla senza rete, ricorda solo in sessione, invalidazione al cambio provider.
- Test adapter Gemini con risposte simulate: testo, fonti, assenza fonti, quota e errore API.
- Test UI: fonti web e Vault restano separate, URL apribili, cronologia conserva i metadati web.
- Test regressione: la ricerca locale attuale non cambia quando la ricerca online è disattivata.

## Decisioni confermate

- La ricerca online è opt-in e disattivata per impostazione predefinita.
- L'utente sceglie fra provider/modello corrente compatibile e provider dedicato.
- Gemini con Google Search grounding è il primo adapter previsto.
- Ogni ricerca richiede consenso, ricordabile soltanto per la sessione.
- Domanda e fonti web sono separate da dati e fonti del Vault; il contesto chat recente è opzionale, limitato e dichiarato nel consenso.
