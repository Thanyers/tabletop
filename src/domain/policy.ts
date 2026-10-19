import type { Asset, CategoryPolicyRule, DepreciationStart, GovernedCategory, Policy } from './types';

export interface ResolvedCategoryPolicy {
  threshold: number;
  usefulLifeMonths: number;
  start: DepreciationStart;
  configured: boolean;
  usesSourceLife: boolean;
}

const DEFAULT_START: DepreciationStart = 'following-month';

export function resolveCategoryPolicy(policy: Policy, asset: Asset): ResolvedCategoryPolicy {
  if (asset.category === 'Laptop') {
    return {
      threshold: policy.laptop.threshold,
      usefulLifeMonths: policy.laptop.usefulLifeMonths,
      start: policy.laptop.start,
      configured: false,
      usesSourceLife: false,
    };
  }

  const rule = asset.category === 'Unknown' ? undefined : policy.categoryRules?.[asset.category];
  const configured = rule !== undefined;
  return {
    threshold: rule?.threshold ?? policy.defaultThreshold,
    usefulLifeMonths: rule?.usefulLifeMonths ?? asset.usefulLifeMonths,
    start: rule?.start ?? DEFAULT_START,
    configured,
    usesSourceLife: rule?.usefulLifeMonths === undefined,
  };
}

export function withCategoryPolicy(
  policy: Policy,
  category: GovernedCategory,
  rule: Partial<CategoryPolicyRule>,
): Policy {
  const existingRules = policy.categoryRules ?? {};
  const current = existingRules[category] ?? {};
  return {
    ...policy,
    categoryRules: {
      ...(existingRules.Furniture === undefined ? {} : { Furniture: { ...existingRules.Furniture } }),
      ...(existingRules.Equipment === undefined ? {} : { Equipment: { ...existingRules.Equipment } }),
      ...(existingRules.Vehicle === undefined ? {} : { Vehicle: { ...existingRules.Vehicle } }),
      [category]: { ...current, ...rule },
    },
  };
}
