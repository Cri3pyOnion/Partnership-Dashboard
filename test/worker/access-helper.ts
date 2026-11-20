// Local RS256 key pair and token signer for tests that go through requireStaff.
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

export const TEAM = 'tohs.cloudflareaccess.com';
export const AUD = 'test-aud-tag';

export async function makeAccess(): Promise<{ jwks: JWTVerifyGetKey; sign: (email: string) => Promise<string> }> {
  const pair = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(pair.publicKey)), alg: 'RS256', kid: 'k1' };
  return {
    jwks: createLocalJWKSet({ keys: [jwk] }),
    sign: (email) =>
      new SignJWT({ email })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(`https://${TEAM}`)
        .setAudience(AUD)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(pair.privateKey),
  };
}
