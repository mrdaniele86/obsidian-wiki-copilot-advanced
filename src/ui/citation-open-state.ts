import type { OpenViewState } from "obsidian";

/** Opens citation documents as stable read-only previews. */
export function citationOpenState(subpath?: string): OpenViewState {
  return {
    active: true,
    state: { mode: "preview" },
    eState: subpath ? { subpath } : undefined
  };
}
