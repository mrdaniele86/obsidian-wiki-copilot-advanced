import type { ChatTurn } from "../core/types";
import type { WebSearchHistoryTurn } from "./types";

export const WEB_SEARCH_HISTORY_MAX_TURNS = 6;
export const WEB_SEARCH_HISTORY_MAX_CHARACTERS = 6_000;

/** Produces a small, chat-only context for an explicitly opted-in web request. */
export function buildWebSearchHistory(turns: ChatTurn[]): WebSearchHistoryTurn[] {
  const recent = turns
    .filter((turn): turn is WebSearchHistoryTurn =>
      (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string" && Boolean(turn.content.trim())
    )
    .slice(-WEB_SEARCH_HISTORY_MAX_TURNS);
  let remaining = WEB_SEARCH_HISTORY_MAX_CHARACTERS;
  const bounded: WebSearchHistoryTurn[] = [];
  for (let index = recent.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const turn = recent[index]!;
    const content = turn.content.slice(-remaining);
    bounded.unshift({ role: turn.role, content });
    remaining -= content.length;
  }
  return bounded;
}
