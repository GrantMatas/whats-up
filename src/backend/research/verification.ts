import type { Happening } from '../../shared/models';
import { sameResearchSubject } from './confidence';
export function verificationQueries(h:Happening,area:string):string[] {
  const title=h.rawMetadata?.kind==='public-post'?h.title.slice(0,120):`"${h.title.slice(0,150)}"`;const place=/location not provided/i.test(h.locationName)?area:h.locationName;
  return [`${title} ${area}`,`${title} organizer ${place}`,`${title} venue calendar`,`${title} cancelled updated`];
}
export function matchingEvidenceRecord(subject:Happening,candidate:Happening):boolean {
  if(!sameResearchSubject(subject,candidate))return false;
  // A standalone community-post snippet is not an event confirmation.
  return !!candidate.startTime||!!candidate.rawMetadata?.uid&&subject.sourceUrl===candidate.sourceUrl;
}
