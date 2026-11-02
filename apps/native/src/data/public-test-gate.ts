export type PublicTestReceipt = { code: string; passed: boolean };

export function codePassedPublicTests(receipt: PublicTestReceipt | undefined, code: string) {
  return receipt?.passed === true && receipt.code === code;
}

/** Pure Racket design-recipe questions have no executable public cases to run. */
export function codeReadyToSubmit(
  content: Record<string, unknown>,
  receipt: PublicTestReceipt | undefined,
  code: string,
) {
  if (
    content.language === 'racket' &&
    (!Array.isArray(content.publicTests) || content.publicTests.length === 0) &&
    !(typeof content.publicTestCode === 'string' && content.publicTestCode.trim())
  )
    return true;
  return codePassedPublicTests(receipt, code);
}

export function allPublicTestsPassed(
  tests: readonly { id: string }[],
  results: Record<string, PublicTestReceipt>,
  code: string,
) {
  return tests.length > 0 && tests.every((test) => codePassedPublicTests(results[test.id], code));
}
