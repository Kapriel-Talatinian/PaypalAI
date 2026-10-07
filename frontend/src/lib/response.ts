import type { Action, WorkspaceCase } from '../types';
import { caseCode } from './format';

/** Prepare an editable submission from existing records, without inventing a customer message. */
export function draftResponse(item: WorkspaceCase, action: Action | null | undefined): string {
  if (action === 'provide_evidence') {
    const sources = item.data.evidence.filter((record) => record.verified);
    if (!sources.length) return '';
    const parts = [`Supporting evidence for dispute ${caseCode(item).slice(0, 120)}.`];
    let included = 0;
    for (const record of sources.slice(0, 4)) {
      const content = record.content.replace(/FACT:-?[a-z0-9_]+/g, '').trim();
      if (!content) continue;
      const excerpt =
        content.length > 350 ? `${content.slice(0, 350).trimEnd()} [excerpt]` : content;
      const block = `${record.id.slice(0, 80)} (${record.kind.slice(0, 40)}; source: ${record.source.slice(0, 80)}):\n${excerpt}`;
      if ([...parts, block].join('\n\n').length > 1850) break;
      parts.push(block);
      included++;
    }
    if (!included) return '';
    if (sources.length > included)
      parts.push(
        'Additional verified records remain available in the case. Review them before sending.',
      );
    return parts.join('\n\n');
  }
  if (action === 'accept_claim') return `I accept the claim for dispute ${caseCode(item)}.`;
  if (action === 'make_offer')
    return `I propose the refund specified below for dispute ${caseCode(item)}.`;
  if (action === 'escalate')
    return `Please review the evidence submitted for dispute ${caseCode(item)}.`;
  return '';
}
