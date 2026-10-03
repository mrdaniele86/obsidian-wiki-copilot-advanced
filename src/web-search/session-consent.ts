export class SessionWebSearchConsent {
  private readonly consentedProviders = new Set<string>();

  has(provider: string, model: string, includesRecentChat = false): boolean {
    return this.consentedProviders.has(this.keyFor(provider, model, includesRecentChat));
  }

  remember(provider: string, model: string, includesRecentChat = false): void {
    this.consentedProviders.add(this.keyFor(provider, model, includesRecentChat));
  }

  clear(): void {
    this.consentedProviders.clear();
  }

  private keyFor(provider: string, model: string, includesRecentChat: boolean): string {
    return JSON.stringify([provider, model, includesRecentChat]);
  }
}
