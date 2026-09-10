import type { Condition, StateValue } from './menu';

export interface ConditionContext {
  state: Record<string, StateValue>;
  flags: ReadonlySet<string>;
}

/** Évalue une condition du format ; une condition absente est toujours vraie. */
export function evaluateCondition(
  condition: Condition | undefined,
  context: ConditionContext,
): boolean {
  if (!condition) return true;
  if ('all' in condition) return condition.all.every((child) => evaluateCondition(child, context));
  if ('any' in condition) return condition.any.some((child) => evaluateCondition(child, context));
  if ('not' in condition) return !evaluateCondition(condition.not, context);
  if ('flag' in condition) return context.flags.has(condition.flag);
  if ('is' in condition) return context.state[condition.state] === condition.is;
  if ('in' in condition) return condition.in.includes(context.state[condition.state]);
  return true;
}
