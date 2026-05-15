import type { NidResult } from '../core/models.js';

export interface CrossFieldIssue {
  field: string;
  reason: string;
}

export function crossFieldCheck(result: NidResult): CrossFieldIssue[] {
  const issues: CrossFieldIssue[] = [];

  const nid = result.nidNumber.value?.replace(/\s+/g, '');
  if (nid) {
    if (result.cardType === 'smart' && nid.length !== 10) {
      issues.push({ field: 'nidNumber', reason: 'Smart NID should have exactly 10 digits' });
    }
    if ((result.cardType === 'laminated' || result.cardType === 'temporary') && ![10, 13, 17].includes(nid.length)) {
      issues.push({ field: 'nidNumber', reason: `${result.cardType} NID should have 10, 13, or 17 digits` });
    }
  }

  if (result.cardType !== 'smart' && result.placeOfBirth.value) {
    issues.push({ field: 'placeOfBirth', reason: 'placeOfBirth is expected only on smart NID back side' });
  }

  if (result.cardType !== 'temporary' && result.validUntil.value) {
    issues.push({ field: 'validUntil', reason: 'validUntil is expected only on temporary NID' });
  }

  const nameEn = result.nameEn.value?.trim();
  const nameBn = result.nameBn.value?.trim();
  if (nameEn && nameBn && !/[\u0980-\u09FF]/.test(nameBn)) {
    issues.push({ field: 'nameBn', reason: 'Bengali name does not contain Bengali script' });
  }

  return issues;
}
