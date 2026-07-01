/**
 * Shared date-injection helper for the CV Optimizer agents (Structure, Bullets).
 *
 * Mirrors the private todayInstruction() in cv-optimizer.service.ts. It is
 * duplicated here intentionally: the original is module-private and the agent
 * architecture is kept self-contained and dormant in this step, so we do not
 * modify the existing service to export it. A later cleanup step can collapse
 * the two into one source.
 *
 * Date is computed at call time — never baked into the prompt constants.
 */
export function todayInstruction(): string {
  const today = new Date().toISOString().split('T')[0];
  return `Today's date is ${today}. Evaluate all dates in the CV relative to this date. Do not flag any date before today as future or unrealistic.`;
}
