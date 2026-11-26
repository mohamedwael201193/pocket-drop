/** When to show a form problem: an address problem once an address is entered, an amount problem once an amount is
 *  entered. An empty amount next to a freshly pasted address is not an error yet; the send button stays disabled. */
export function showSpendProblem(problem: string | null, addressProblem: boolean, to: string, amount: string): boolean {
  if (!problem) return false;
  return addressProblem ? to.trim() !== '' : amount.trim() !== '';
}
