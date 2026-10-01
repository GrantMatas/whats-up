import type { Happening, Source } from '../../shared/models';
export interface CollectionResult { records: Happening[]; checkedAt: string; status: 'success' | 'blocked' | 'failed'; reason?: string }
export interface Collector { readonly parserType: Source['parserType']; collect(source: Source, signal: AbortSignal): Promise<CollectionResult> }
export const extractionPriority = ['cache', 'rss', 'jsonld', 'ical', 'json', 'html', 'isolated-browser'] as const;
