import { z } from 'zod';
import type { Category, Happening, Location, SourceClass } from './models';

export const scanModes = ['smart', 'quick', 'deep', 'refresh'] as const;
export type ScanMode = typeof scanModes[number];
export const scanningSettingsSchema = z.object({
  enabled: z.boolean().default(true), onOpen: z.boolean().default(true),
  intervalHours: z.number().int().min(1).max(168).default(24),
  discoveryHours: z.number().int().min(6).max(168).default(24),
  rediscoveryHours: z.number().int().min(24).max(720).default(72),
  searchEndpoint: z.string().max(2048).refine(value=>{if(!value)return true;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&(!url.port||url.port==='443');}catch{return false;}},'Use a public HTTPS instance base URL without credentials or query parameters').default(''),
}).strict();
export const defaultScanning = scanningSettingsSchema.parse({});
export type ScanningSettings = z.infer<typeof scanningSettingsSchema>;
export interface ScanRun {
  id: string; locationKey: string; mode: ScanMode; origin: 'manual' | 'scheduled' | 'startup';
  status: 'running' | 'complete' | 'failed' | 'interrupted'; startedAt: string; completedAt: string | null;
  phase: string; totalTasks: number; completedTasks: number; sourcesChecked: number;
  findings: number; updated: number; duplicates: number; radarMatches: number; failures: number;
  currentActivity: string | null; error: string | null;
}
export interface ScanTask {
  id: string; runId: string; kind: 'discovery' | 'search' | 'fetch' | 'browser' | 'verification' | 'geocoding';
  label: string; url?: string; status: 'running' | 'complete' | 'failed'; startedAt: string;
  completedAt: string | null; result: string | null;
}
export interface Evidence {
  id: string; happeningId: string; sourceUrl: string; sourceName: string; sourceType: SourceClass;
  observedAt: string; publishedAt: string | null; title: string; startTime: string | null;
  allDay?:boolean;
  locationName: string; organizer: string | null; structured: boolean; cancelled: boolean;
  role: 'publisher' | 'organizer' | 'venue' | 'reference'; excerpt: string; independentGroup: string;
}
export interface ConfidenceFactor { key: string; label: string; points: number; explanation: string }
export interface Contradiction { field: 'time' | 'location' | 'status'; description: string; claims: { value: string; sourceUrl: string; sourceName: string }[] }
export interface ConfidenceAssessment {
  happeningId: string; score: number; label: 'High' | 'Moderate' | 'Low'; assessedAt: string;
  factors: ConfidenceFactor[]; uncertainties: string[]; contradictions: Contradiction[]; evidence: Evidence[];
}
export interface EventHistoryEntry {
  id: string; happeningId: string; at: string; kind: 'new' | 'updated' | 'confirmed' | 'cancelled' | 'conflicting' | 'research';
  description: string; previousConfidence?: number; confidence?: number; changes?: { field: string; before: string; after: string }[];
}
export const watchAreaSchema = z.object({
  id: z.string().min(1).max(400), name: z.string().trim().min(1).max(100),
  location: z.object({ name: z.string(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), timezone: z.string().optional(), countryCode: z.string().optional(), region: z.string().optional(), key: z.string().optional() }).strict(),
  radiusMiles: z.number().min(1).max(150), interests: z.array(z.string().min(1).max(400)).max(30),
  scanning: scanningSettingsSchema.default(defaultScanning),
}).strict();
export type WatchArea = z.infer<typeof watchAreaSchema>;
export interface UserFeedback { happeningId: string; relevant: boolean; at: string; locationKey: string }
export interface CoverageCategory { category: Category; sources: number; healthy: number; findings: number; score: number; label: 'Excellent' | 'Good' | 'Limited' | 'Missing' }
export interface AreaCoverage { score: number; categories: CoverageCategory[]; assessedAt: string; explanation: string }
export interface HappeningRelationship { fromId: string; toId: string; reason: string; type: 'same-venue' | 'nearby-impact' | 'related-topic' }
export interface SourceRelationship { fromId: string; toId: string; url: string; kind: 'advertised-link' | 'search-result' }
export interface PulseSnapshot { at: string; locationKey: string; count: number; score: number; categories: Partial<Record<Category, number>> }
export interface IntelligenceState {
  scans: ScanRun[]; tasks: ScanTask[]; assessments: ConfidenceAssessment[]; history: EventHistoryEntry[];
  watchAreas: WatchArea[]; feedback: UserFeedback[]; coverage: AreaCoverage;
  relationships: HappeningRelationship[]; sourceRelationships: SourceRelationship[]; pulse: PulseSnapshot[];
}
export interface SearchResult { title: string; url: string; snippet: string; provider: string; query: string; foundAt: string }
export interface SearchCache { key: string; query: string; provider: string; locationKey: string; results: SearchResult[]; expiresAt: string; error?: string }
export type ConfidenceWeights = { official: number; organization: number; news: number; community: number; structured: number; recent: number; independent: number; venue: number; organizer: number; consistent: number; conflict: number; cancelled: number; stale: number; history: number };
export const defaultConfidenceWeights: ConfidenceWeights = { official: 35, organization: 24, news: 22, community: 10, structured: 12, recent: 8, independent: 14, venue: 12, organizer: 16, consistent: 10, conflict: -20, cancelled: -30, stale: -15, history: 6 };
export function evidenceFromHappening(h: Happening, observedAt = h.lastVerifiedAt): Evidence {
  const host = new URL(h.sourceUrl).hostname.replace(/^www\./, '').toLowerCase();
  const sameHost=(url:unknown)=>{try{return typeof url==='string'&&new URL(url).hostname.replace(/^www\./,'')===host;}catch{return false;}};
  const role=sameHost(h.rawMetadata?.organizerUrl)?'organizer':sameHost(h.rawMetadata?.venueUrl)?'venue':'publisher';
  const parts=host.split('.');const commonSuffix=/\.(?:co\.uk|org\.uk|com\.au|co\.nz)$/.test(host);const group=parts.slice(commonSuffix?-3:-2).join('.');
  return { id: `${h.id}:${h.sourceUrl}`, happeningId: h.id, sourceUrl: h.sourceUrl, sourceName: h.sourceName, sourceType: h.sourceType, observedAt, publishedAt: h.publishedAt ?? null, title: h.title, startTime: h.startTime, allDay:h.allDay, locationName: h.locationName, organizer: typeof h.rawMetadata?.organizer === 'string' ? h.rawMetadata.organizer : null, structured: /^(jsonld|ical|json)$/.test(String(h.rawMetadata?.format)), cancelled: /cancelled|canceled/i.test(String(h.rawMetadata?.status ?? h.rawMetadata?.eventStatus ?? '')), role, excerpt: h.summary.slice(0,240), independentGroup: group };
}
