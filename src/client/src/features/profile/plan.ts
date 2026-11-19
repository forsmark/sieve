import type { RescorePlanDto } from '../../../../shared/api';

/** Plain text for a rescore plan. `judge` and `extract` are model calls; `rulesOnly` is free. */
export function planText(plan: RescorePlanDto): string {
  const calls = plan.judge + plan.extract;
  if (calls === 0 && plan.rulesOnly === 0) return 'No postings need rescoring.';
  const parts: string[] = [];
  if (calls > 0) parts.push(`${calls} model ${calls === 1 ? 'call' : 'calls'} (${plan.judge} to judge, ${plan.extract} to extract facts)`);
  if (plan.rulesOnly > 0) parts.push(`${plan.rulesOnly} ${plan.rulesOnly === 1 ? 'posting' : 'postings'} rescored by rules only, which costs nothing`);
  return `${parts.join(' and ')}.`;
}
