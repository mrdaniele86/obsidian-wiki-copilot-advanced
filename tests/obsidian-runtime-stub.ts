export class Component {
  addChild(): Component { return new Component(); }
  registerDomEvent(): void {}
}

export class ItemView extends Component {}
export class Modal {
  contentEl = {} as HTMLElement;
  open(): void {}
  close(): void {}
}
export class ConfirmationModal extends Modal {}
export class Notice {}
export class WorkspaceLeaf {}
export class TFile {}
export const Platform = { isMobile: false };
export const parseLinktext = (value: string): { path: string; subpath: string } => ({ path: value, subpath: "" });
export const setIcon = (): void => undefined;
export const MarkdownRenderer = { render: async (): Promise<void> => undefined };
export const requestUrl = async (): Promise<never> => {
  throw new Error("requestUrl is unavailable in unit tests");
};
