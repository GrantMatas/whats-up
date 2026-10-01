import type { Happening, Location } from '../../shared/models';
import { distanceMiles, expandTopic, textCorpus, tokenize } from '../search/intent';
export function rankHappening(h: Happening, interests: string[], location: Location, now: string): Happening {
  const age = Math.max(0, Date.parse(now) - Date.parse(h.publishedAt ?? h.discoveredAt)) / 3600000;
  const freshness = Math.round(100 * Math.exp(-age / 168));
  const words = new Set(tokenize(textCorpus(h))); const terms = interests.flatMap(tokenize);
  const interest = terms.length ? terms.filter(t => expandTopic(t).some(w => words.has(w))).length / terms.length : 0;
  const proximity = h.latitude !== null && h.longitude !== null ? Math.max(0, 1 - distanceMiles(location.latitude, location.longitude, h.latitude, h.longitude) / 75) : 0.3;
  return { ...h, freshness, relevance: Math.round(Math.min(100, h.importance * 0.25 + h.confidence * 0.15 + freshness * 0.2 + interest * 25 + proximity * 15)) };
}
