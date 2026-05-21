export function canOfferRetry({ nonInteractive, retryCount, maxRetries }) {
  if (nonInteractive) return false;
  if (!Number.isFinite(maxRetries)) return true;
  return retryCount < maxRetries;
}
