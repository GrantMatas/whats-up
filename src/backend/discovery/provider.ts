export interface DiscoveryQuery { query: string; locationName: string; radiusMiles: number }
export interface DiscoveryResult { title: string; url: string; snippet: string }
export interface WebDiscoveryProvider { readonly name: string; discover(query: DiscoveryQuery, signal: AbortSignal): Promise<DiscoveryResult[]> }
// Public directory discovery is provided by WikipediaDirectory; callers can replace it.
