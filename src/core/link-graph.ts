import { CooperativeScheduler, yieldToUi } from "./cooperative";
import type { YieldControl } from "./cooperative";

export interface LinkNeighbor {
  path: string;
  linkCount: number;
  direction: "outgoing" | "backlink" | "both";
}

export type ResolvedLinks = Readonly<Record<string, Readonly<Record<string, number>>>>;
export type LinkGraphSnapshot = Array<[string, Array<[string, number]>]>;

export interface LinkGraphSyncResult {
  applied: boolean;
  changed: boolean;
}

type EdgeMap = Map<string, Map<string, number>>;

function addEdge(
  outgoingIndex: EdgeMap,
  incomingIndex: EdgeMap,
  source: string,
  destination: string,
  count: number
): void {
  const outgoing = outgoingIndex.get(source) ?? new Map<string, number>();
  outgoing.set(destination, (outgoing.get(destination) ?? 0) + count);
  outgoingIndex.set(source, outgoing);

  const incoming = incomingIndex.get(destination) ?? new Map<string, number>();
  incoming.set(source, (incoming.get(source) ?? 0) + count);
  incomingIndex.set(destination, incoming);
}

function removeSourceEdges(
  outgoingIndex: EdgeMap,
  incomingIndex: EdgeMap,
  source: string
): void {
  const current = outgoingIndex.get(source);
  if (!current) {
    return;
  }
  for (const destination of current.keys()) {
    const incoming = incomingIndex.get(destination);
    incoming?.delete(source);
    if (incoming?.size === 0) {
      incomingIndex.delete(destination);
    }
  }
  outgoingIndex.delete(source);
}

function replaceSourceEdges(
  outgoingIndex: EdgeMap,
  incomingIndex: EdgeMap,
  source: string,
  destinations: ReadonlyMap<string, number>
): void {
  removeSourceEdges(outgoingIndex, incomingIndex, source);
  for (const [destination, count] of destinations) {
    addEdge(outgoingIndex, incomingIndex, source, destination, count);
  }
}

function edgeMapsEqual(
  current: ReadonlyMap<string, number> | undefined,
  next: ReadonlyMap<string, number>
): boolean {
  if ((current?.size ?? 0) !== next.size) {
    return false;
  }
  for (const [destination, count] of next) {
    if (current?.get(destination) !== count) {
      return false;
    }
  }
  return true;
}

export class LinkGraph {
  private outgoing: EdgeMap = new Map();
  private incoming: EdgeMap = new Map();

  createSnapshot(): LinkGraphSnapshot {
    return [...this.outgoing.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([source, destinations]) => [
        source,
        [...destinations.entries()].sort(([left], [right]) => left.localeCompare(right))
      ]);
  }

  restoreSnapshot(snapshot: LinkGraphSnapshot): void {
    const outgoing: EdgeMap = new Map();
    const incoming: EdgeMap = new Map();
    for (const [source, destinations] of snapshot) {
      for (const [destination, count] of destinations) {
        addEdge(outgoing, incoming, source, destination, count);
      }
    }
    this.outgoing = outgoing;
    this.incoming = incoming;
  }

  rebuild(resolvedLinks: ResolvedLinks): void {
    const outgoing: EdgeMap = new Map();
    const incoming: EdgeMap = new Map();

    for (const [source, destinations] of Object.entries(resolvedLinks)) {
      for (const [destination, count] of Object.entries(destinations)) {
        if (source === destination || count <= 0) {
          continue;
        }
        addEdge(outgoing, incoming, source, destination, count);
      }
    }
    this.outgoing = outgoing;
    this.incoming = incoming;
  }

  async rebuildAsync(
    resolvedLinks: ResolvedLinks,
    shouldContinue: () => boolean = () => true,
    yieldControl: YieldControl = yieldToUi
  ): Promise<boolean> {
    const outgoing: EdgeMap = new Map();
    const incoming: EdgeMap = new Map();
    const scheduler = new CooperativeScheduler(8, 32, yieldControl);

    for (const [source, destinations] of Object.entries(resolvedLinks)) {
      for (const [destination, count] of Object.entries(destinations)) {
        if (source !== destination && count > 0) {
          addEdge(outgoing, incoming, source, destination, count);
        }
        await scheduler.checkpoint();
        if (!shouldContinue()) {
          return false;
        }
      }
    }
    if (!shouldContinue()) {
      return false;
    }
    this.outgoing = outgoing;
    this.incoming = incoming;
    return true;
  }

  async synchronizeAsync(
    resolvedLinks: ResolvedLinks,
    shouldContinue: () => boolean = () => true,
    yieldControl: YieldControl = yieldToUi
  ): Promise<LinkGraphSyncResult> {
    const replacements = new Map<string, Map<string, number>>();
    const currentSources = new Set<string>();
    const scheduler = new CooperativeScheduler(8, 512, yieldControl);

    for (const [source, destinations] of Object.entries(resolvedLinks)) {
      currentSources.add(source);
      const normalized = new Map<string, number>();
      for (const [destination, count] of Object.entries(destinations)) {
        if (source !== destination && count > 0) {
          normalized.set(destination, count);
        }
        await scheduler.checkpoint();
        if (!shouldContinue()) {
          return { applied: false, changed: false };
        }
      }
      if (!edgeMapsEqual(this.outgoing.get(source), normalized)) {
        replacements.set(source, normalized);
      }
    }

    for (const source of this.outgoing.keys()) {
      if (!currentSources.has(source)) {
        replacements.set(source, new Map());
      }
      await scheduler.checkpoint();
      if (!shouldContinue()) {
        return { applied: false, changed: false };
      }
    }
    if (!shouldContinue()) {
      return { applied: false, changed: false };
    }

    for (const [source, destinations] of replacements) {
      replaceSourceEdges(this.outgoing, this.incoming, source, destinations);
    }
    return { applied: true, changed: replacements.size > 0 };
  }

  neighbors(path: string, limit = 12): LinkNeighbor[] {
    const outgoing = this.outgoing.get(path) ?? new Map<string, number>();
    const incoming = this.incoming.get(path) ?? new Map<string, number>();
    const all = new Set([...outgoing.keys(), ...incoming.keys()]);

    return [...all]
      .map((neighbor): LinkNeighbor => {
        const outgoingCount = outgoing.get(neighbor) ?? 0;
        const incomingCount = incoming.get(neighbor) ?? 0;
        return {
          path: neighbor,
          linkCount: outgoingCount + incomingCount,
          direction: outgoingCount > 0 && incomingCount > 0
            ? "both"
            : outgoingCount > 0
              ? "outgoing"
              : "backlink"
        };
      })
      .sort((left, right) => right.linkCount - left.linkCount || left.path.localeCompare(right.path))
      .slice(0, limit);
  }

  degree(path: string): number {
    return new Set([
      ...(this.outgoing.get(path)?.keys() ?? []),
      ...(this.incoming.get(path)?.keys() ?? [])
    ]).size;
  }

  get edgeCount(): number {
    let count = 0;
    for (const destinations of this.outgoing.values()) {
      count += destinations.size;
    }
    return count;
  }

}
