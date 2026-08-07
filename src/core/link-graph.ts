import { CooperativeScheduler, yieldToUi } from "./cooperative";
import type { YieldControl } from "./cooperative";

export interface LinkNeighbor {
  path: string;
  linkCount: number;
  direction: "outgoing" | "backlink" | "both";
}

export type ResolvedLinks = Readonly<Record<string, Readonly<Record<string, number>>>>;

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

export class LinkGraph {
  private outgoing: EdgeMap = new Map();
  private incoming: EdgeMap = new Map();

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
