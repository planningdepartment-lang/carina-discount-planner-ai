import { D1Database } from '@cloudflare/workers-types';

/**
 * Enterprise Admin Authentication & Session Management
 * Built using native Web Crypto API (PBKDF2-SHA256) for Cloudflare Workers.
 */

const PBKDF2_ITERATIONS = 100000;
const SESSION_DURATION_HOURS = 8;
export const COOKIE_NAME = 'carina_admin_session';

/**
 * Converts ArrayBuffer to Hex String
 */
function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Converts Hex String to Uint8Array
 */
function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Hashes a password using PBKDF2-SHA256 with 100,000 iterations.
 */
export async function hashPassword(
  password: string,
  existingSaltHex?: string
): Promise<{ hash: string; salt: string }> {
  const encoder = new TextEncoder();
  const salt = existingSaltHex ? hexToBuffer(existingSaltHex) : crypto.getRandomValues(new Uint8Array(16));
  const saltHex = existingSaltHex || bufferToHex(salt.buffer);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    256 // 32 bytes
  );

  const hashHex = bufferToHex(derivedBits);
  return { hash: hashHex, salt: saltHex };
}

/**
 * Constant-time password verification to prevent timing side-channel attacks.
 */
export async function verifyPassword(
  password: string,
  saltHex: string,
  targetHashHex: string
): Promise<boolean> {
  const { hash } = await hashPassword(password, saltHex);
  if (hash.length !== targetHashHex.length) return false;

  let mismatch = 0;
  for (let i = 0; i < hash.length; i++) {
    mismatch |= hash.charCodeAt(i) ^ targetHashHex.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Generates a high-entropy 256-bit random session token.
 */
export function generateSessionToken(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  return bufferToHex(randomBytes.buffer);
}

/**
 * Parses HTTP Cookie header into key-value pairs.
 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  const items = cookieHeader.split(';');
  for (const item of items) {
    const parts = item.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      cookies[key] = decodeURIComponent(val);
    }
  }
  return cookies;
}

/**
 * Creates HttpOnly, Secure, SameSite=Lax Set-Cookie string.
 */
export function createSessionCookie(sessionId: string): string {
  const maxAge = SESSION_DURATION_HOURS * 3600;
  return `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/**
 * Creates a cookie header that immediately expires the session.
 */
export function createClearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/**
 * Creates an admin session in D1.
 */
export async function createAdminSession(
  db: D1Database,
  adminId: string,
  ipAddress = 'unknown',
  userAgent = 'unknown'
): Promise<string> {
  const sessionId = generateSessionToken();
  await db.prepare(`
    INSERT INTO admin_sessions (session_id, admin_id, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' hours'))
  `).bind(sessionId, adminId, ipAddress, userAgent, SESSION_DURATION_HOURS).run();

  await db.prepare(`
    UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(adminId).run();

  return sessionId;
}

/**
 * Validates an admin session from D1.
 */
export async function validateAdminSession(
  db: D1Database,
  sessionId: string
): Promise<{ isValid: boolean; admin?: { id: string; email: string; displayName: string } }> {
  if (!sessionId) return { isValid: false };

  try {
    const { results } = await db.prepare(`
      SELECT s.session_id, s.expires_at, u.id, u.email, u.display_name, u.is_active
      FROM admin_sessions s
      JOIN admin_users u ON s.admin_id = u.id
      WHERE s.session_id = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = 1
    `).bind(sessionId).all<any>();

    if (!results || results.length === 0) {
      return { isValid: false };
    }

    const row = results[0];
    return {
      isValid: true,
      admin: {
        id: row.id,
        email: row.email,
        displayName: row.display_name
      }
    };
  } catch (err) {
    console.error('Session validation query error:', err);
    return { isValid: false };
  }
}

/**
 * Revokes an admin session (Logout).
 */
export async function revokeAdminSession(
  db: D1Database,
  sessionId: string
): Promise<void> {
  if (!sessionId) return;
  try {
    await db.prepare('DELETE FROM admin_sessions WHERE session_id = ?').bind(sessionId).run();
  } catch (err) {
    console.error('Session revocation error:', err);
  }
}
