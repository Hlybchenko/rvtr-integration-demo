/** Check whether a string is a parseable absolute URL */
export function isValidUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
