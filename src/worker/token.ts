/** A partner view link token: 32 random bytes as unpadded base64url (43 chars). */
export function newViewToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isTokenShape(t: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(t);
}

/** SHA-256 of the token, lowercase hex. Used as the KV key so raw tokens are never stored there. */
export async function hashToken(t: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
