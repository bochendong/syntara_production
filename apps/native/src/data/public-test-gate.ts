export type PublicTestReceipt = { code: string; passed: boolean };

export function codePassedPublicTests(receipt: PublicTestReceipt | undefined, code: string) {
  return receipt?.passed === true && receipt.code === code;
}

export function allPublicTestsPassed(
  tests: readonly { id: string }[],
  results: Record<string, PublicTestReceipt>,
  code: string,
) {
  return tests.length > 0 && tests.every((test) => codePassedPublicTests(results[test.id], code));
}
