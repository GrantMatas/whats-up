import { z } from 'zod';
import { scanningSettingsSchema, defaultScanning, scanModes, defaultConfidenceWeights, type IntelligenceState, type WatchArea, type ConfidenceWeights } from './intelligence';

export const categories = ['music', 'community', 'traffic', 'weather', 'government', 'safety', 'food', 'technology', 'sports', 'news', 'business', 'education', 'arts', 'other', 'events', 'construction', 'public_service', 'public_safety'] as const;
export const sourceClasses = ['OFFICIAL', 'CONFIRMED', 'NEWS', 'ORGANIZATION', 'COMMUNITY', 'UNVERIFIED'] as const;
export type Category = typeof categories[number];
export type SourceClass = typeof sourceClasses[number];
const iso = z.string().datetime({ offset: true });
const text = z.string().trim().min(1).max(400);
const score = z.number().finite().min(0).max(100);
export const httpsUrlSchema = z.string().max(2048).url().refine(value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } }, 'A public HTTPS URL is required');
const position = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
export const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }).strict(),
  z.object({ type: z.literal('LineString'), coordinates: z.array(position).min(2).max(2000) }).strict(),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(position).min(4).max(2000)).min(1).max(20) }).strict().refine(g => g.coordinates.every(ring => ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1]), 'Polygon rings must be closed'),
]);
export type Geometry = z.infer<typeof geometrySchema>;
export const relatedSourceSchema = z.object({ name: text, url: httpsUrlSchema, type: z.enum(sourceClasses) }).strict();
export const happeningSchema = z.object({
  id: text, title: text, summary: z.string().max(2000), detailedSummary: z.string().max(10000),
  category: z.enum(categories), subcategory: text,
  startTime: iso.nullable(), endTime: iso.nullable(), discoveredAt: iso, updatedAt: iso, lastVerifiedAt: iso,
  latitude: z.number().finite().min(-90).max(90).nullable(), longitude: z.number().finite().min(-180).max(180).nullable(),
  geometryType: z.enum(['POINT', 'LINESTRING', 'POLYGON']).nullable(), geometry: geometrySchema.nullable(),
  locationName: text, address: z.string().max(500), sourceName: text, sourceType: z.enum(sourceClasses), sourceUrl: httpsUrlSchema,
  confidence: score, importance: score, freshness: score, relevance: score,
  images: z.array(httpsUrlSchema).max(10), tags: z.array(text).max(40), relatedSources: z.array(relatedSourceSchema).max(30), isDemo: z.boolean().refine(value=>!value, "Only real records are supported"),
  publishedAt: iso.nullable().optional(), sourceId: text.optional(), originalUrl: httpsUrlSchema.optional(), locationAccuracy: z.enum(['exact', 'approximate', 'region', 'unknown']).optional(), allDay: z.boolean().optional(), rawMetadata: z.record(z.string(), z.unknown()).optional(), timezone: text.optional(), locationKey: text.optional(),
}).strict().refine(h => !h.endTime || !h.startTime || Date.parse(h.endTime) >= Date.parse(h.startTime), 'End must follow start').refine(h => h.geometry ? ({ Point: 'POINT', LineString: 'LINESTRING', Polygon: 'POLYGON' })[h.geometry.type] === h.geometryType : h.geometryType === null, 'Geometry type must agree');
export type Happening = z.infer<typeof happeningSchema>;
export const locationSchema = z.object({ name: text, latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), timezone: text.optional(), countryCode: text.optional(), region: text.optional(), key: text.optional(), discoveryName: text.optional() }).strict();
export type Location = z.infer<typeof locationSchema>;
export const settingsSchema = z.object({
  onboarded: z.boolean(), location: locationSchema,
  radiusMiles: z.number().finite().min(1).max(150), interests: z.array(text).max(30),
  theme: z.enum(['light', 'dark', 'system']), density: z.enum(['comfortable', 'compact', 'editorial']), motion: z.boolean(), demoMode: z.boolean().refine(value=>!value, "Only real data is supported"),
  defaultView: z.enum(['overview', 'map', 'discover', 'radar', 'reports', 'sources', 'settings', 'timeline', 'calendar', 'changes', 'topics', 'graph', 'feed', 'heatmap', 'collections']),
  scanning: scanningSettingsSchema.default(defaultScanning), tutorialCompleted: z.boolean().default(false),
  notifications: z.object({ enabled: z.boolean().default(false), radar: z.boolean().default(true), alerts: z.boolean().default(true), changes: z.boolean().default(true) }).strict().default({enabled:false,radar:true,alerts:true,changes:true}),
  visibleCategories: z.array(z.enum(categories)).max(30).default([...categories]),
  mapStyle: z.enum(['streets','minimal']).default('streets'), timelineDensity: z.enum(['day','hour']).default('day'),
  homeModules: z.array(z.enum(['pulse','activity','coverage','discoveries'])).default(['pulse','activity','coverage','discoveries']),
  sourceTypes:z.array(z.enum(sourceClasses)).max(6).default([...sourceClasses]), chartDays:z.union([z.literal(7),z.literal(14),z.literal(30)]).default(7),
  confidenceWeights: z.record(z.string(), z.number().min(-100).max(100)).default(defaultConfidenceWeights),
}).strict();
export type AppSettings = z.infer<typeof settingsSchema>;
export const radarSchema = z.object({ id: text, name: text, query: z.string().trim().min(1).max(600), radiusMiles: z.number().finite().min(1).max(150), enabled: z.boolean(), createdAt: iso, relevanceThreshold: score.optional(), priority:z.enum(["high","normal","low"]).optional(), lastScan: iso.nullable().optional(), locationKey: text.optional(), topics:z.array(text).max(100).optional(), exclusions:z.array(text).max(100).optional(), timePreference:z.enum(['all','now','today','tonight','tomorrow','weekend','week']).optional() }).strict();
export type Radar = z.infer<typeof radarSchema>;
export const sourceSchema = z.object({
  sourceId: text, name: text, url: httpsUrlSchema, domain: text, type: z.enum(sourceClasses), region: text,
  lastChecked: iso.nullable(), lastSuccessful: iso.nullable(), checkFrequency: z.number().int().min(60),
  parserType: z.enum(['rss', 'jsonld', 'ical', 'json', 'html']), reliability: score, failureCount: z.number().int().min(0), isDemo: z.boolean().refine(value=>!value, "Only real sources are supported"),
  enabled: z.boolean().optional(), locationKey: text.optional(), nextCheckAt: iso.nullable().optional(), etag: z.string().max(1000).nullable().optional(), lastModified: z.string().max(1000).nullable().optional(), lastError: z.string().max(2000).nullable().optional(), status: z.enum(['idle', 'checking', 'healthy', 'failed', 'blocked']).optional(), discoveredAt: iso.optional(), unchangedChecks: z.number().int().min(0).optional(), robotsAllowed: z.boolean().optional(), timeoutMs: z.number().int().min(1000).max(60000).optional(), notes: z.string().max(2000).optional(),
}).strict();
export type Source = z.infer<typeof sourceSchema>;
export interface EngineState { scanning: boolean; phase: string; sourcesDiscovered: number; sourcesHealthy: number; pagesChecked: number; newHappenings: number; duplicatesMerged: number; browserSessions: number; failures: number; currentlyChecking: string | null; lastScan: string | null; nextScan: string | null; error: string | null; httpRequests: number; queueSize: number; updatedHappenings: number; sourcesFailed: number; currentJob: string | null }
export interface RadarMatch { radarId: string; happeningId: string; score: number; reasons: string[]; matchedAt: string; isNew: boolean }
export interface AppState { settings: AppSettings; happenings: Happening[]; radars: Radar[]; savedIds: string[]; sources: Source[]; engine?: EngineState; radarMatches?: RadarMatch[]; intelligence?: IntelligenceState }
export const scanSchema = z.object({ query: z.string().trim().max(600).optional(), force: z.boolean().optional(), mode: z.enum(scanModes).optional(), origin: z.enum(['manual','scheduled','startup']).optional(), category: z.enum(categories).optional() }).strict();
export type ScanRequest = z.infer<typeof scanSchema>;
export interface SourceCheck { sourceId: string; checkedAt: string; status: 'success' | 'not-modified' | 'failed' | 'blocked'; httpStatus?: number; recordsFound?: number; durationMs?: number; error?: string; etag?: string | null; lastModified?: string | null; extracted?: number; rejected?: number; updates?: number; merged?: number; locationKey?: string; parser?: Source['parserType']; inserted?: number; updated?: number; duplicates?: number }
export interface CachedDocument { url: string; body: string; contentType: string; fetchedAt: string; expiresAt: string; etag?: string | null; lastModified?: string | null }
export interface WhatsUpBridge {
  getState(): Promise<AppState>;
  saveSettings(settings: AppSettings): Promise<AppState>;
  toggleSaved(id: string): Promise<AppState>;
  saveRadar(radar: Radar): Promise<AppState>;
  deleteRadar(id: string): Promise<AppState>;
  resetData(): Promise<AppState>;
  resetSetup(): Promise<AppState>;
  addSource(url: string): Promise<AppState>;
  saveWatchArea(area: WatchArea): Promise<AppState>;
  deleteWatchArea(id: string): Promise<AppState>;
  switchWatchArea(id: string): Promise<AppState>;
  feedback(id: string, relevant: boolean): Promise<AppState>;
  openExternal(url: string): Promise<void>;
  sourceHistory(id:string):Promise<SourceCheck[]>;
  scanDetails(id:string):Promise<{run:import('./intelligence').ScanRun;tasks:import('./intelligence').ScanTask[]}>;
  scan(request?: ScanRequest): Promise<AppState>;
  resolveLocation(query: string): Promise<Location>;
  search(query: string): Promise<Happening[]>;
  onStateChanged(callback: (state: AppState) => void): () => void;
}
export const idSchema = text;
export const IPC = Object.freeze({ getState: 'whatsup:get-state', saveSettings: 'whatsup:save-settings', toggleSaved: 'whatsup:toggle-saved', saveRadar: 'whatsup:save-radar', deleteRadar: 'whatsup:delete-radar', resetData: 'whatsup:reset', resetSetup:'whatsup:reset-setup', addSource:'whatsup:add-source', saveWatchArea:'whatsup:save-watch-area', deleteWatchArea:'whatsup:delete-watch-area', switchWatchArea:'whatsup:switch-watch-area', feedback:'whatsup:feedback', openExternal: 'whatsup:open-external', sourceHistory:'whatsup:source-history', scanDetails:'whatsup:scan-details', scan: 'whatsup:scan', resolveLocation: 'whatsup:resolve-location', search: 'whatsup:search', stateChanged: 'whatsup:state-changed' });
