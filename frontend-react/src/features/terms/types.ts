import type { TermsConfiguration } from '../../types/api';
export type { TermsConfiguration, TermsAcceptance } from '../../types/api';

export type PublishedTerms = TermsConfiguration & {
  configured: true;
  version: string;
  document_url: string;
  document_sha256: string;
};

export function isPublishedTerms(current: TermsConfiguration): current is PublishedTerms {
  return (
    current.configured &&
    Boolean(current.version && current.document_url && current.document_sha256)
  );
}
