import type { AppSettings, Happening, Radar, RadarMatch } from '../../shared/models';
import { distanceMiles, matchesIntent, parseIntent } from '../search/intent';
export function matchRadar(radar: Radar, happenings: Happening[], settings: AppSettings, now: string): Happening[] {
  if (!radar.enabled) return [];
  const parsed=parseIntent(radar.query);
  const intent = { ...parsed, topics:radar.topics??parsed.topics, exclusions:radar.exclusions??parsed.exclusions, timeWindow:radar.timePreference??parsed.timeWindow, radiusMiles: radar.radiusMiles };
  return happenings.filter(h => matchesIntent(h, intent, settings.location, radar.radiusMiles, now, settings.location.timezone)).filter(h => h.relevance >= (radar.relevanceThreshold ?? 0)).sort((a, b) => b.relevance - a.relevance);
}
export function evaluateRadar(radar: Radar, happenings: Happening[], settings: AppSettings, now: string): RadarMatch[] {
  const intent = parseIntent(radar.query);
  return matchRadar(radar, happenings, settings, now).map(h => ({ radarId: radar.id, happeningId: h.id, score: h.relevance, matchedAt: now, isNew: true, reasons: [...intent.topics.map(topic => `Matches topic: ${topic}`), ...(h.latitude !== null && h.longitude !== null ? [`${distanceMiles(settings.location.latitude,settings.location.longitude,h.latitude,h.longitude).toFixed(1)} miles away · within ${radar.radiusMiles} mile radius`] : ['Location unconfirmed; source covers selected area']), ...(intent.timeWindow !== 'all' ? [`In ${intent.timeWindow} time window`] : [])] }));
}
