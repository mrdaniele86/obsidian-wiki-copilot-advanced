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

  acquire(createLeaf: () => TLeaf, isAttached: (leaf: TLeaf) => boolean): AcquiredLeaf<TLeaf> {
    if (this.leaf && isAttached(this.leaf)) {
      return { leaf: this.leaf, created: false };
    }

    const leaf = createLeaf();
    this.leaf = leaf;
    return { leaf, created: true };
  }

  discard(leaf: TLeaf): void {
    if (this.leaf !== leaf || leaf.getViewState().pinned) {
      return;
    }
    this.leaf = null;
    leaf.detach();
  }

  close(): void {
    const leaf = this.leaf;
    this.leaf = null;
    if (!leaf || leaf.getViewState().pinned) {
      return;
    }
    leaf.detach();
  }
}
