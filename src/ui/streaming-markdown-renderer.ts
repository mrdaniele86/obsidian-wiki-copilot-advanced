import { Component, MarkdownRenderer } from "obsidian";
import type { App } from "obsidian";

const RENDER_INTERVAL_MS = 90;

export interface StreamingMarkdownRendererOptions {
  shouldKeepPinned?: () => boolean;
  onRendered?: (keepPinned: boolean) => void;
}

/** Coalesces model deltas so Obsidian Markdown is not re-rendered for every token. */
export class StreamingMarkdownRenderer extends Component {
  private readonly renderWindow: Window;
  private renderComponent: Component | null = null;
  private pendingMarkdown = "";
  private renderedMarkdown = "";
  private scheduledRender: number | undefined;
  private rendering: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly app: App,
    private readonly container: HTMLElement,
    private readonly sourcePath = "",
    private readonly options: StreamingMarkdownRendererOptions = {}
  ) {
    super();
    this.renderWindow = container.ownerDocument.defaultView ?? window;
  }

  update(markdown: string): void {
    if (this.stopped || markdown === this.pendingMarkdown) {
      return;
    }
    this.pendingMarkdown = markdown;
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.rendering || this.scheduledRender !== undefined) {
      return;
    }
    this.scheduledRender = this.renderWindow.setTimeout(() => {
      this.scheduledRender = undefined;
      void this.renderLatest();
    }, RENDER_INTERVAL_MS);
  }

  async finalize(markdown: string): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.pendingMarkdown = markdown;
    if (this.scheduledRender !== undefined) {
      this.renderWindow.clearTimeout(this.scheduledRender);
      this.scheduledRender = undefined;
    }
    if (this.rendering) {
      await this.rendering;
    }
    if (this.scheduledRender !== undefined) {
      this.renderWindow.clearTimeout(this.scheduledRender);
      this.scheduledRender = undefined;
    }
    if (this.renderedMarkdown !== this.pendingMarkdown) {
      await this.renderLatest();
    }
  }

  override onunload(): void {
    this.stopped = true;
    if (this.scheduledRender !== undefined) {
      this.renderWindow.clearTimeout(this.scheduledRender);
      this.scheduledRender = undefined;
    }
    this.renderComponent = null;
  }

  private async renderLatest(): Promise<void> {
    if (this.stopped || this.renderedMarkdown === this.pendingMarkdown || this.rendering) {
      return this.rendering ?? Promise.resolve();
    }
    const snapshot = this.pendingMarkdown;
    const operation = this.renderSnapshot(snapshot);
    this.rendering = operation;
    try {
      await operation;
      this.renderedMarkdown = snapshot;
    } finally {
      if (this.rendering === operation) {
        this.rendering = null;
      }
      if (!this.stopped && this.pendingMarkdown !== this.renderedMarkdown) {
        this.scheduleRender();
      }
    }
  }

  private async renderSnapshot(markdown: string): Promise<void> {
    const keepPinned = this.options.shouldKeepPinned?.() ?? false;
    if (this.renderComponent) {
      this.removeChild(this.renderComponent);
      this.renderComponent = null;
    }
    this.container.empty();
    const component = this.addChild(new Component());
    this.renderComponent = component;
    try {
      await MarkdownRenderer.render(this.app, markdown, this.container, this.sourcePath, component);
    } catch {
      if (this.renderComponent === component) {
        this.container.empty();
        this.container.setText(markdown);
      }
    }
    this.options.onRendered?.(keepPinned);
  }
}
