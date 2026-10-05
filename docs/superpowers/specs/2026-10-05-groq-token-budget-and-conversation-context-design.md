# Budget token Groq e contesto conversazionale

## Obiettivo

Evitare richieste Groq superiori al TPM e rendere esplicito quanto contesto viene inviato al modello, senza cambiare retrieval Vault, consenso o flusso Web. L'utente può scegliere se inviare la cronologia normale; per impostazione predefinita il plugin mantiene il comportamento precedente al fork: domanda corrente ed evidenze Vault, senza turni precedenti.

## Impostazioni

Nel gruppo chat/modello vengono aggiunte impostazioni persistite e validate:

- `includeRecentConversationContext`, booleano, default `false`;
- `maximumInputTokens`, scelta `automatic`, `4000`, `6000`, `8000`, `12000`, `16000` o `custom`, con valore personalizzato intero valido;
- `maximumOutputTokens`, scelta numerica (inizialmente 512, 1024, 2048, 4096) o valore personalizzato valido.

Automatico non impone un limite ai provider generici. Per l'hostname esatto normalizzato `api.groq.com` applica il profilo prudente: budget input 7.000 token e output 512 token, salvo esplicita impostazione utente. Gli endpoint custom diversi da Groq conservano payload e opzioni attuali; DeepSeek conserva le opzioni già proprie. Il contatore UI mostra una stima locale, per esempio `Token richiesta: 6430 / 7000`, basata sullo stesso stimatore usato dal builder: non è una promessa del tokenizer remoto.

## Costruzione del prompt

Un modulo puro riceve system prompt, domanda effettiva (incluso il blocco di chiarimento), cronologia e blocchi di fonte già ordinati per rilevanza. Calcola il budget prompt effettivo con margine di sicurezza del 12%, includendo ruoli, wrapper, marker `[S#]`, domanda e istruzioni di chiarimento. Non taglia mai la domanda corrente né il system prompt.

L'ordine di conservazione è: domanda/chiarimento, system prompt, coppia stretta del chiarimento, fonti RAG più rilevanti con wrapper e marker interi, poi i turni normali più recenti. Questo privilegia una risposta radicata nel Vault senza far ricomparire una cronologia lunga. Se lo spazio è insufficiente, elimina i turni più vecchi, poi blocchi fonte meno rilevanti; un blocco fonte è conservato o rimosso intero. Se un singolo blocco rilevante non entra, ne mantiene il wrapper/marker e riduce solo il corpo, senza spezzare i delimitatori. La strategia di recupero usa un profilo temporaneo più severo e non muta impostazioni, retrieval persistito o conversazione salvata.

Con il toggle disattivato, il planner e la completion ricevono nessuna cronologia ordinaria. Un chiarimento immediato usa comunque soltanto obiettivo originale, richiesta di chiarimento e risposta nuova, incorporati nella domanda effettiva; non riaccende lo storico. Con toggle attivato, planner e completion ricevono la finestra attuale, poi il builder applica il budget.

## Errori e recupero

Gli errori vengono classificati in `input-too-large`, `rate-limited` e `request-failed`. `input-too-large` richiede 413 oppure indicatori specifici in 400/429 (TPM, token/minute, requested-versus-limit, context length, too many tokens); un normale 429 è `rate-limited`. Le UI IT/EN/ZH mostrano solo messaggi locali e non interpolano mai testo provider riconosciuto.

Solo `input-too-large` mostra `Riprova con contesto ridotto`. L'azione non è automatica, riusa la stessa domanda una sola volta, non appende un ulteriore turno utente e passa il profilo recovery. Rate limit e errore generico non offrono quell'azione.

## Verifica

Test unitari dimostrano rilevamento hostname Groq, contabilità del prompt, margine, preservazione domanda/marker, pruning deterministico e immutabilità. Test client/UI coprono output cap, endpoint custom invariato, toggle entrambi i modi, chiarimento ristretto, classificazione errori e retry. La conclusione richiede `pnpm check`, `pnpm verify:brat-beta` e revisione del diff; nessuna pubblicazione, tag o push.
