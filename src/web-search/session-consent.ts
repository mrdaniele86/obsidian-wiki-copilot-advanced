export class SessionWebSearchConsent {
  private readonly consentedProviders = new Set<string>();

  has(provider: string, model: string): boolean {
    return this.consentedProviders.has(this.keyFor(provider, model));
  }

  remember(provider: string, model: string): void {
    this.consentedProviders.add(this.keyFor(provider, model));
  }

  clear(): void {
    this.consentedProviders.clear();
  }

  private keyFor(provider: string, model: string): string {
    return JSON.stringify([provider, model]);
  }
}
