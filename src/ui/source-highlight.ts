export function findExpandedSourceButton(
  container: HTMLElement,
  sourceId: string
): HTMLButtonElement | null {
  const details = container.querySelector<HTMLDetailsElement>("details.wiki-copilot-sources");
  if (!details?.open) {
    return null;
  }
  return [...details.querySelectorAll<HTMLButtonElement>("button.wiki-copilot-source")]
    .find((button) => button.dataset.sourceId === sourceId) ?? null;
}
