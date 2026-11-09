import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface TokenPayload {
  userId: string;
  role: string;
}

export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: '15m' });
}

// PREPROTO-AUTH G3 — refresh tokens carry a jti that keys the
// server-side RefreshToken store (rotation + revocation). A refresh
// token without a jti (issued pre-G3) has no store row and is rejected.
export interface RefreshTokenPayload extends TokenPayload {
  jti: string;
}

export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function generateRefreshToken(payload: TokenPayload, jti: string): string {
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_TTL_MS / 1000,
    jwtid: jti,
  });
}

// PREPROTO-AUTH G4 — pin the algorithm on verify. Without the pin,
// jsonwebtoken accepts any HMAC variant the attacker names in the header
// (and historically alg-confusion attacks rode exactly this hole).
export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as TokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.JWT_REFRESH_SECRET, {
    algorithms: ['HS256'],
  }) as RefreshTokenPayload;
}
