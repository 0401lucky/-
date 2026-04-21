const UNSAFE_REDIRECT_PATTERN = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

export function getSafeRedirectPath(
  candidate: string | null | undefined,
  fallback: string = "/"
): string {
  if (typeof candidate !== "string") {
    return fallback;
  }

  const value = candidate.trim();
  if (!value || !value.startsWith("/")) {
    return fallback;
  }

  if (UNSAFE_REDIRECT_PATTERN.test(value) || value.startsWith("//") || /[\\\r\n]/.test(value)) {
    return fallback;
  }

  try {
    const decoded = decodeURIComponent(value);
    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      UNSAFE_REDIRECT_PATTERN.test(decoded) ||
      /[\\\r\n]/.test(decoded)
    ) {
      return fallback;
    }
  } catch {
    return fallback;
  }

  return value;
}
