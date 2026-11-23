export function parseRequestBody<T>(rawBody: unknown): T | null {
  if (rawBody === null || rawBody === undefined) return null;
  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody) as T;
    } catch {
      return null;
    }
  }
  if (typeof rawBody === 'object') {
    return rawBody as T;
  }
  return null;
}
