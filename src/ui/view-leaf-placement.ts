export interface MobileRootViewPlan<T> {
  reusable: T | null;
  drawerLeaves: T[];
}

/** Keeps the mobile Copilot view in Obsidian's main tab area instead of its nested drawer. */
export function planMobileRootView<T>(
  rootLeaves: readonly T[],
  viewLeaves: readonly T[]
): MobileRootViewPlan<T> {
  const rootSet = new Set(rootLeaves);
  return {
    reusable: viewLeaves.find((leaf) => rootSet.has(leaf)) ?? null,
    drawerLeaves: viewLeaves.filter((leaf) => !rootSet.has(leaf))
  };
}
