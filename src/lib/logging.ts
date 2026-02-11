export function maskUserId(userId: string | number | null | undefined): string {
  if (userId === null || userId === undefined) {
    return 'unknown';
  }

  const raw = String(userId).trim();
  if (!raw) {
    return 'unknown';
  }

  if (raw.length <= 2) {
    return `${raw[0]}*`;
  }

  return `${raw.slice(0, 1)}***${raw.slice(-1)}`;
}

export function maskUsername(username: string | null | undefined): string {
  if (!username) {
    return 'unknown';
  }

  const value = username.trim();
  if (!value) {
    return 'unknown';
  }

  if (value.length <= 2) {
    return `${value[0]}*`;
  }

  return `${value.slice(0, 1)}***${value.slice(-1)}`;
}
