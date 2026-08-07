import workerCode from "virtual:source-catalog-worker";
import type {
  SourceCatalogDocument,
  SourceCatalogWorkerHit,
  SourceCatalogWorkerRequest,
  SourceCatalogWorkerResponse
} from "./source-catalog-protocol";

interface PendingRequest {
  resolve: (response: SourceCatalogWorkerResponse) => void;
  reject: (error: Error) => void;
}

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

export class SourceCatalogWorkerClient {
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private failure: Error | null = null;

  private constructor(private readonly worker: Worker) {
    worker.onmessage = (event: MessageEvent<SourceCatalogWorkerResponse>) => {
      this.receive(event.data);
    };
    worker.onerror = (event) => {
      this.failure = new Error(event.message || "原文目录 Worker 运行失败");
      this.failAll(this.failure);
    };
    worker.onmessageerror = () => {
      this.failure = new Error("原文目录 Worker 消息无法解析");
      this.failAll(this.failure);
    };
  }

  static create(): SourceCatalogWorkerClient | null {
    if (!workerCode || typeof Worker === "undefined" || typeof URL === "undefined") {
      return null;
    }
    try {
      const url = URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" }));
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      return new SourceCatalogWorkerClient(worker);
    } catch (error) {
      console.warn("Wiki Copilot: 原文目录 Worker 不可用，将使用分时索引。", error);
      return null;
    }
  }

  async reset(): Promise<void> {
    await this.request({ type: "reset" });
  }

  async upsert(documents: SourceCatalogDocument[]): Promise<void> {
    await this.request({ type: "upsert", documents });
  }

  async remove(paths: string[]): Promise<void> {
    await this.request({ type: "remove", paths });
  }

  async search(query: string, includePending: boolean, limit: number): Promise<SourceCatalogWorkerHit[]> {
    const response = await this.request({ type: "search", query, includePending, limit });
    return response.type === "search-results" ? response.hits : [];
  }

  destroy(): void {
    this.worker.terminate();
    this.failAll(new Error("原文目录 Worker 已停止"));
  }

  private request(
    message: WithoutId<SourceCatalogWorkerRequest>
  ): Promise<SourceCatalogWorkerResponse> {
    const id = this.nextId;
    this.nextId += 1;
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id } satisfies SourceCatalogWorkerRequest);
    });
  }

  private receive(response: SourceCatalogWorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    if (response.type === "error") {
      pending.reject(new Error(response.message));
    } else {
      pending.resolve(response);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
