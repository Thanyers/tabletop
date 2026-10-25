import { ArrowUpLeft, Link2 } from 'lucide-react';
import { sourceEvidence, type SourceCue } from './sourceEvidence';
import type { CaseId } from './types';
import './evidence-origin.css';

export function EvidenceOrigin({ caseId, purpose, onInspect }: {
  caseId: CaseId; purpose: SourceCue['purpose']; onInspect: () => void;
}) {
  const evidence = sourceEvidence(caseId, purpose);
  return <button type="button" className="evidence-origin" data-testid="evidence-origin" data-purpose={purpose}
    onClick={onInspect} aria-label={`ดูหลักฐานที่มา: ${evidence.location}`}>
    <Link2 size={15} aria-hidden="true" />
    <span><strong>{evidence.targetLabel}</strong><small>{evidence.location}</small></span>
    <ArrowUpLeft size={15} aria-hidden="true" />
  </button>;
}
