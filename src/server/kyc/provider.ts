/**
 * Identity-verification provider interface. In this code base the only
 * implementation is manual review: submissions go to the compliance queue and
 * a person decides. An automated provider (document and liveness checks)
 * would implement `submit` by sending the documents to the provider and
 * receive its result by a signed webhook, which would still be recorded as a
 * reviewable decision — never as an automatic "verified" from an upload.
 */
export interface IdentityProvider {
  readonly id: string;
  readonly automated: boolean;
  submit(input: { userId: string; documentIds: string[] }): Promise<{ provider: string; reference: string }>;
}

export const manualReviewProvider: IdentityProvider = {
  id: 'manual',
  automated: false,
  async submit(input) {
    return { provider: 'manual', reference: `queue:${input.documentIds.length} document(s)` };
  },
};

export function identityProvider(): IdentityProvider {
  return manualReviewProvider;
}
