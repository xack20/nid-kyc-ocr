import type { NidResult } from '../core/models.js';
import type { NidFieldKey, SmartRoutingDecision, Tier1SmartResult } from '../core/smartTypes.js';
import { NID_FIELD_KEYS } from '../core/smartTypes.js';

const BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const MONTHS = new Set(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

export interface ValidationIssue {
  field: NidFieldKey;
  reason: string;
}

function valueOf(result: NidResult, field: NidFieldKey): string | null {
  return result[field].value;
}

function validateNidNumber(result: NidResult): ValidationIssue[] {
  const value = valueOf(result, 'nidNumber')?.replace(/\s+/g, '') ?? '';
  if (!value) return [{ field: 'nidNumber', reason: 'NID number is missing' }];
  if (!/^\d+$/.test(value)) return [{ field: 'nidNumber', reason: 'NID number contains non-digit characters' }];

  const allowed = result.cardType === 'smart' ? [10] : [10, 13, 17];
  if (!allowed.includes(value.length)) {
    return [{ field: 'nidNumber', reason: `Unexpected NID length ${value.length} for ${result.cardType}` }];
  }
  return [];
}

function validateDateField(result: NidResult, field: 'dateOfBirth' | 'issueDate' | 'validUntil'): ValidationIssue[] {
  const value = valueOf(result, field);
  if (!value) return [];

  const match = value.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!match) return [{ field, reason: `${field} is not in DD MMM YYYY format` }];

  const day = Number(match[1]);
  const month = match[2];
  const year = Number(match[3]);
  if (day < 1 || day > 31 || !MONTHS.has(month) || year < 1900 || year > 2100) {
    return [{ field, reason: `${field} has an invalid date value` }];
  }
  return [];
}

function validateBloodGroup(result: NidResult): ValidationIssue[] {
  const value = valueOf(result, 'bloodGroup');
  if (!value) return [];
  const normalised = value.replace('0', 'O').toUpperCase();
  return BLOOD_GROUPS.has(normalised)
    ? []
    : [{ field: 'bloodGroup', reason: `Invalid blood group "${value}"` }];
}

function validateBanglaFields(result: NidResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of ['nameBn', 'fatherNameBn', 'motherNameBn', 'addressBn'] as const) {
    const value = valueOf(result, field);
    if (value && !/[\u0980-\u09FF]/.test(value)) {
      issues.push({ field, reason: `${field} does not contain Bengali script` });
    }
  }
  return issues;
}

export function validateNidResult(result: NidResult): ValidationIssue[] {
  return [
    ...validateNidNumber(result),
    ...validateDateField(result, 'dateOfBirth'),
    ...validateDateField(result, 'issueDate'),
    ...validateDateField(result, 'validUntil'),
    ...validateBloodGroup(result),
    ...validateBanglaFields(result),
  ];
}

export function routeSmartFields(
  tier1: Tier1SmartResult,
  cvConfidenceThreshold: number,
): SmartRoutingDecision[] {
  const validationIssues = validateNidResult(tier1.extraction);

  return NID_FIELD_KEYS.map((field) => {
    const fieldResult = tier1.extraction[field];
    const source = tier1.fieldSources[field];
    const validationIssue = validationIssues.find(issue => issue.field === field);

    if (!fieldResult.value && !fieldResult.needsReview) {
      return { field, action: 'absent', reason: 'Field not expected or not present on provided side', source };
    }

    if (
      fieldResult.confidence === 'high'
      && !fieldResult.needsReview
      && !source?.needsVision
      && !validationIssue
      && (source?.minConfidence ?? 1) >= cvConfidenceThreshold
    ) {
      return { field, action: 'pass', reason: 'Tier-1 parse and CV confidence passed', source };
    }

    const reason = [
      fieldResult.confidence !== 'high' ? `field confidence=${fieldResult.confidence}` : null,
      fieldResult.needsReview ? 'tier1 needsReview=true' : null,
      source?.needsVision ? source.reason : null,
      source && source.minConfidence < cvConfidenceThreshold ? `CV confidence ${source.minConfidence.toFixed(2)} below threshold` : null,
      validationIssue?.reason ?? null,
    ].filter(Boolean).join('; ');

    return { field, action: 'verify', reason: reason || 'Verification requested', source };
  });
}
