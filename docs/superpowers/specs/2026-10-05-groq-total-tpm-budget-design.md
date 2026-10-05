# Budget totale TPM Groq configurabile

## Obiettivo

Rendere comprensibile e applicabile il limite token-per-minuto (TPM) di un account Groq. Il plugin deve impedire che il massimo input effettivo e il massimo output configurato superino il budget totale dell'account, con margine di sicurezza, senza cambiare il comportamento degli endpoint compatibili non-Groq.

## Impostazioni

`ModelSettings` aggiunge `groqTotalTokensPerMinute`, un valore `automatic` oppure un intero fra 512 e 32000. Per l'hostname esatto `api.groq.com`, `automatic` equivale a 8000; per tutti gli altri endpoint non crea limiti né modifica richieste esistenti. Il campo impostazioni si chiama “Limite totale token/minuto dell'account (TPM)”; il valore predefinito salvato rimane `automatic`.

Input e output restano due impostazioni indipendenti. L'input è il tetto del prompt completo; l'output è il massimo completamento chiesto al provider. Il campo TPM non assume un tier o un modello: l'utente imposta il limite effettivo del proprio account.

## Budget della richiesta

Per Groq il client calcola una riserva input come il minimo tra il limite input già scelto e `TPM totale - output massimo`. Applica quindi il margine prudenziale del planner al budget prompt rimanente. In questo modo, con TPM 8000 e input/output 4000, il planner invia al massimo un prompt prudenziale inferiore a 4000 e un completamento massimo di 4000; il totale resta sotto il limite configurato.

La domanda utente, system prompt, chiarimento immediato, marker e wrapper delle fonti restano soggetti alle priorità già definite. Se il budget input risultante non può contenere i contenuti obbligatori, la richiesta viene bloccata localmente con un errore sicuro, senza mutare impostazioni, conversazione, fonti o retrieval.

## UI e messaggi

Nelle impostazioni Groq la UI mostra una stima esplicita: `Budget Groq: input stimato X + output Y / TPM Z`. Se input e output non sono compatibili, spiega che input e output condividono lo stesso TPM e indica un valore input massimo sicuro; non invia dettagli raw del provider.

L'avviso di `finish_reason: length` resta distinto: significa solo che la risposta ha raggiunto “Token massimi in output”. Le traduzioni IT/EN/ZH lo spiegano con un suggerimento a ridurre o aumentare il limite output, non suggeriscono numeri TPM.

## Compatibilità e verifica

- Il riconoscimento Groq resta limitato al hostname `api.groq.com` normalizzato.
- Endpoint custom non-Groq, DeepSeek, invio normale, Vault retrieval, consenso e ricerca Web restano invariati.
- Test coprono default automatico Groq, TPM personalizzato, margine, input/output incompatibili, UI e traduzioni, endpoint non-Groq invariato e localizzazione dell'avviso output.
- La conclusione richiede `pnpm check`, `pnpm verify:brat-beta` e revisione diff. Pubblicazione, tag e push richiedono conferma esplicita.
