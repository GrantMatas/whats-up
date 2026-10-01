import type { Category, Geometry } from '../../shared/models';

export type ParserType = 'rss' | 'jsonld' | 'ical' | 'json' | 'html';
/** Source facts only: omitted fields remain unknown during normalization. */
export interface ExtractedRecord {
  sourceUrl: string;
  title: string;
  summary: string;
  category?: Category;
  subcategory?: string;
  startTime?: string;
  endTime?: string;
  publishedAt?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
  geometry?: Geometry;
  address?: string;
  locationName?: string;
  tags?: string[];
  allDay?: boolean;
  images?: string[];
  rawMetadata?: Record<string, unknown>;
}
export interface DiscoveredLink { url: string; parserType: Exclude<ParserType, 'jsonld'>; name: string }
export interface ExtractionResult { records: ExtractedRecord[]; discoveredLinks: DiscoveredLink[]; parserType: ParserType }
