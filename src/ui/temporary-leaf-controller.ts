export interface ReusableLeafLike {
  detach(): void;
  getViewState(): { pinned?: boolean };
}

export interface AcquiredLeaf<TLeaf> {
  leaf: TLeaf;
  created: boolean;
}

export class ReusableLeafController<TLeaf extends ReusableLeafLike> {
  private leaf: TLeaf | null = null;
  private origin: TLeaf | null = null;

  acquire(
    createLeaf: () => TLeaf,
    isAttached: (leaf: TLeaf) => boolean,
    origin?: TLeaf
  ): AcquiredLeaf<TLeaf> {
    if (this.leaf && isAttached(this.leaf)) {
      this.origin = origin ?? null;
      return { leaf: this.leaf, created: false };
    }

    const leaf = createLeaf();
    this.leaf = leaf;
    this.origin = origin ?? null;
    return { leaf, created: true };
  }

  originFor(leaf: TLeaf, isAttached: (leaf: TLeaf) => boolean): TLeaf | null {
    if (this.leaf !== leaf || !this.origin || !isAttached(this.origin)) {
      return null;
    }
    return this.origin;
  }

  discard(leaf: TLeaf): void {
    if (this.leaf !== leaf || leaf.getViewState().pinned) {
      return;
    }
    this.leaf = null;
    this.origin = null;
    leaf.detach();
  }

  close(): void {
    const leaf = this.leaf;
    this.leaf = null;
    this.origin = null;
    if (!leaf || leaf.getViewState().pinned) {
      return;
    }
    leaf.detach();
  }
}
