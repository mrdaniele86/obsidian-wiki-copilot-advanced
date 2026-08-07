export interface TemporaryLeafLike {
  detach(): void;
  getViewState(): { pinned?: boolean };
}

export class TemporaryLeafController<TLeaf extends TemporaryLeafLike> {
  private leaf: TLeaf | null = null;

  track(leaf: TLeaf): void {
    if (this.leaf === leaf) {
      return;
    }
    this.release();
    this.leaf = leaf;
  }

  handleActiveLeafChange(activeLeaf: TLeaf | null): void {
    if (!this.leaf || activeLeaf === this.leaf) {
      return;
    }
    this.release();
  }

  close(): void {
    this.release();
  }

  private release(): void {
    const leaf = this.leaf;
    this.leaf = null;
    if (!leaf || leaf.getViewState().pinned) {
      return;
    }
    leaf.detach();
  }
}
