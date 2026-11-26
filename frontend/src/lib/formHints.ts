/** When to show a form problem: an address problem once an address is entered, an amount problem once an amount is
 *  entered. An empty amount next to a freshly pasted address is not an error yet; the send button stays disabled. */
export function showSpendProblem(problem: string | null, addressProblem: boolean, to: string, amount: string): boolean {
  if (!problem) return false;
  return addressProblem ? to.trim() !== '' : amount.trim() !== '';
}

/** While the amount field has focus, a problem that more typing can fix (empty, "0", "0.", below the minimum) is not shown
 *  yet: typing 0.05 passes through "0" and "0.0". It shows once the field loses focus. A too-high amount shows at once. */
export function showAmountProblem(incomplete: boolean, focused: boolean): boolean {
  return !(incomplete && focused);
}
