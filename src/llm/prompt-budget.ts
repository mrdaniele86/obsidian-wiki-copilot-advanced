export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PromptBudgetInput {
  systemPrompt: string;
  question: string;
  history?: readonly PromptMessage[];
  evidence?: readonly string[];
  limitTokens?: number;
}

export interface PromptBudgetPlan {
  messages: PromptMessage[];
  usedTokens: number;
  limitTokens: number | undefined;
  overBudget: boolean;
}

const SAFETY_MARGIN = 0.12;
const MESSAGE_OVERHEAD_TOKENS = 8;

function textTokens(value: string): number {
  let ordinaryAscii = 0;
  let conservativeTokens = 0;
  for (const character of value) {
    if (/\p{Extended_Pictographic}/u.test(character)) {
      conservativeTokens += 2;
    } else if (/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u.test(character)) {
      conservativeTokens += 1;
    } else if (/[`{}[\]();=<>/\\]/u.test(character)) {
      conservativeTokens += 1;
    } else if (character.codePointAt(0)! > 0x7f) {
      conservativeTokens += 1;
    } else {
      ordinaryAscii += 1;
    }
  }
  return conservativeTokens + Math.ceil(ordinaryAscii / 3);
}

function messageTokens(message: PromptMessage): number {
  return MESSAGE_OVERHEAD_TOKENS + textTokens(message.role) + textTokens(message.content);
}

export function isGroqEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint?.trim()) return false;
  try {
    return new URL(endpoint.trim()).hostname.toLowerCase() === "api.groq.com";
  } catch {
    return false;
  }
}

export function estimatePromptTokens(messages: readonly PromptMessage[]): number {
  return 3 + messages.reduce((total, message) => total + messageTokens(message), 0);
}

function safeBudget(limitTokens: number | undefined): number | undefined {
  if (!Number.isFinite(limitTokens) || !limitTokens || limitTokens <= 0) return undefined;
  return Math.floor(limitTokens * (1 - SAFETY_MARGIN));
}

function evidenceWithinBudget(
  evidence: string,
  messages: readonly PromptMessage[],
  budget: number | undefined
): string | null {
  const complete = [...messages, { role: "user" as const, content: evidence }];
  if (budget === undefined || estimatePromptTokens(complete) <= budget) return evidence;

  const match = /^(\s*<wiki-copilot-source\b[^>]*>)([\s\S]*)(<\/wiki-copilot-source>\s*)$/iu.exec(evidence);
  if (!match) return null;
  const opening = match[1];
  const body = match[2];
  const closing = match[3];
  if (opening === undefined || body === undefined || closing === undefined) return null;
  if (estimatePromptTokens([...messages, { role: "user", content: `${opening}${closing}` }]) > (budget ?? Infinity)) {
    return null;
  }

  const bodyCharacters = Array.from(body);
  const shortened = (length: number): string => `${opening}${bodyCharacters.slice(0, length).join("")}\n[Source excerpt shortened for the prompt budget.]\n${closing}`;
  if (estimatePromptTokens([...messages, { role: "user", content: shortened(0) }]) > (budget ?? Infinity)) {
    return `${opening}${closing}`;
  }

  let low = 0;
  let high = bodyCharacters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = shortened(middle);
    if (estimatePromptTokens([...messages, { role: "user", content: candidate }]) <= (budget ?? Infinity)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return shortened(low);
}

export function planPromptBudget(input: PromptBudgetInput): PromptBudgetPlan {
  const limitTokens = input.limitTokens;
  const budget = safeBudget(limitTokens);
  const systemMessage: PromptMessage = { role: "system", content: input.systemPrompt };
  const questionMessage: PromptMessage = { role: "user", content: `Question:\n${input.question}` };
  const selectedEvidence: string[] = [];
  const evidence = input.evidence ?? [];
  const history = input.history ?? [];
  const evidenceMessages = (): PromptMessage[] => selectedEvidence.map((content) => ({ role: "user", content }));

  if (evidence[0]) {
    const content = evidenceWithinBudget(evidence[0], [systemMessage, questionMessage], budget);
    if (content) selectedEvidence.push(content);
  }

  const selectedHistory: PromptMessage[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (!turn) continue;
    const candidate = [{ ...turn }, ...selectedHistory];
    const candidateMessages = [
      systemMessage,
      ...candidate,
      questionMessage,
      ...evidenceMessages()
    ];
    if (budget === undefined || estimatePromptTokens(candidateMessages) <= budget) {
      selectedHistory.unshift({ ...turn });
    }
  }

  for (const block of evidence.slice(1)) {
    while (selectedHistory.length > 0 && budget !== undefined) {
      const withFullEvidence = [
        systemMessage,
        ...selectedHistory,
        questionMessage,
        ...evidenceMessages(),
        { role: "user" as const, content: block }
      ];
      if (estimatePromptTokens(withFullEvidence) <= budget) break;
      selectedHistory.shift();
    }
    const content = evidenceWithinBudget(
      block,
      [systemMessage, ...selectedHistory, questionMessage, ...evidenceMessages()],
      budget
    );
    if (content) selectedEvidence.push(content);
  }

  const finalMessages: PromptMessage[] = [
    systemMessage,
    ...selectedHistory,
    questionMessage,
    ...selectedEvidence.map((content) => ({ role: "user" as const, content }))
  ];
  return {
    messages: finalMessages,
    usedTokens: estimatePromptTokens(finalMessages),
    limitTokens,
    overBudget: budget !== undefined && estimatePromptTokens(finalMessages) > budget
  };
}
