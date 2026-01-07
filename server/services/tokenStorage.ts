/**
 * Token Storage Service
 *
 * Handles OAuth token storage in SQL Server database.
 * Replaces file-based token.json storage for multi-user support.
 *
 * See ADR-002 for decision rationale.
 */

import { query, queryAll } from './database.js';
import fs from 'fs';
import path from 'path';

// Token data structure
export interface StoredToken {
  userEmail: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date;
  scopes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Google OAuth token format
export interface GoogleToken {
  access_token: string;
  refresh_token: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
  expiry?: string;
}

// Fallback to file-based storage (for backwards compatibility during migration)
const PROJECT_ROOT = process.cwd();
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const TOKEN_PATH = path.join(DATA_DIR, 'token.json');

// Feature flag for database storage
const USE_DATABASE_TOKENS = process.env.USE_DATABASE_TOKENS !== 'false';

/**
 * Save OAuth token to database.
 */
export async function saveToken(
  userEmail: string,
  token: GoogleToken
): Promise<void> {
  if (!USE_DATABASE_TOKENS) {
    // Fallback to file storage
    const tokenWithEmail = { ...token, email: userEmail };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenWithEmail, null, 2));
    console.log(`[TokenStorage] Saved token to file for: ${userEmail}`);
    return;
  }

  try {
    const expiry = getExpiryDate(token);
    const scopes = token.scope || '';

    await query(
      `EXEC dbo.UpsertOAuthToken
        @UserEmail = @userEmail,
        @AccessToken = @accessToken,
        @RefreshToken = @refreshToken,
        @TokenExpiry = @tokenExpiry,
        @Scopes = @scopes`,
      {
        userEmail,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenExpiry: expiry,
        scopes
      }
    );

    console.log(`[TokenStorage] Saved token to database for: ${userEmail}`);
  } catch (error) {
    console.error(`[TokenStorage] Error saving token for ${userEmail}:`, error);
    throw error;
  }
}

/**
 * Get OAuth token from database.
 */
export async function getToken(userEmail: string): Promise<StoredToken | null> {
  if (!USE_DATABASE_TOKENS) {
    // Fallback to file storage
    return getTokenFromFile(userEmail);
  }

  try {
    const results = await queryAll<{
      user_email: string;
      access_token: string;
      refresh_token: string;
      token_expiry: Date;
      scopes: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      'EXEC dbo.GetOAuthToken @UserEmail = @userEmail',
      { userEmail }
    );

    if (results.length === 0) {
      console.log(`[TokenStorage] No token found for: ${userEmail}`);
      return null;
    }

    const row = results[0];
    return {
      userEmail: row.user_email,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      tokenExpiry: row.token_expiry,
      scopes: row.scopes || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch (error) {
    console.error(`[TokenStorage] Error getting token for ${userEmail}:`, error);
    // Fallback to file on database error
    return getTokenFromFile(userEmail);
  }
}

/**
 * Delete OAuth token from database.
 */
export async function deleteToken(userEmail: string): Promise<void> {
  if (!USE_DATABASE_TOKENS) {
    // Fallback to file storage
    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
      if (token.email === userEmail) {
        fs.unlinkSync(TOKEN_PATH);
        console.log(`[TokenStorage] Deleted token file for: ${userEmail}`);
      }
    }
    return;
  }

  try {
    await query(
      'EXEC dbo.DeleteOAuthToken @UserEmail = @userEmail',
      { userEmail }
    );
    console.log(`[TokenStorage] Deleted token from database for: ${userEmail}`);
  } catch (error) {
    console.error(`[TokenStorage] Error deleting token for ${userEmail}:`, error);
    throw error;
  }
}

/**
 * Check if a valid token exists for user.
 */
export async function hasValidToken(userEmail: string): Promise<boolean> {
  const token = await getToken(userEmail);
  if (!token) return false;

  // Check if token is expired (with 5 minute buffer)
  const now = new Date();
  const expiryWithBuffer = new Date(token.tokenExpiry.getTime() - 5 * 60 * 1000);

  if (now >= expiryWithBuffer) {
    // Token is expired or expiring soon, but we have a refresh token
    return !!token.refreshToken;
  }

  return true;
}

/**
 * Get tokens that are expiring soon (for background refresh).
 */
export async function getExpiringTokens(minutesBeforeExpiry: number = 15): Promise<StoredToken[]> {
  if (!USE_DATABASE_TOKENS) {
    return [];
  }

  try {
    const results = await queryAll<{
      user_email: string;
      access_token: string;
      refresh_token: string;
      token_expiry: Date;
      scopes: string | null;
    }>(
      'EXEC dbo.GetExpiringTokens @MinutesBeforeExpiry = @minutes',
      { minutes: minutesBeforeExpiry }
    );

    return results.map(row => ({
      userEmail: row.user_email,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      tokenExpiry: row.token_expiry,
      scopes: row.scopes || undefined
    }));
  } catch (error) {
    console.error('[TokenStorage] Error getting expiring tokens:', error);
    return [];
  }
}

/**
 * Convert StoredToken back to GoogleToken format.
 */
export function toGoogleToken(stored: StoredToken): GoogleToken {
  return {
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken,
    expiry_date: stored.tokenExpiry.getTime(),
    scope: stored.scopes
  };
}

/**
 * Get any valid token (for single-user backwards compatibility).
 * Used when user email is not known (e.g., API key auth without X-Test-User).
 */
export async function getAnyValidToken(): Promise<StoredToken | null> {
  if (!USE_DATABASE_TOKENS) {
    return getTokenFromFile();
  }

  try {
    // Get the most recently updated token
    const results = await queryAll<{
      user_email: string;
      access_token: string;
      refresh_token: string;
      token_expiry: Date;
      scopes: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT TOP 1
        user_email, access_token, refresh_token, token_expiry, scopes, created_at, updated_at
       FROM oauth_tokens
       ORDER BY updated_at DESC`
    );

    if (results.length === 0) {
      return getTokenFromFile(); // Fallback to file
    }

    const row = results[0];
    return {
      userEmail: row.user_email,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      tokenExpiry: row.token_expiry,
      scopes: row.scopes || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch (error) {
    console.error('[TokenStorage] Error getting any token:', error);
    return getTokenFromFile(); // Fallback to file
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get expiry date from Google token.
 */
function getExpiryDate(token: GoogleToken): Date {
  if (token.expiry_date) {
    return new Date(token.expiry_date);
  }
  if (token.expiry) {
    return new Date(token.expiry);
  }
  // Default to 1 hour from now
  return new Date(Date.now() + 3600 * 1000);
}

/**
 * Get token from file (backwards compatibility).
 */
function getTokenFromFile(userEmail?: string): StoredToken | null {
  if (!fs.existsSync(TOKEN_PATH)) {
    return null;
  }

  try {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    const email = token.email || token.account || userEmail || 'default@user.com';

    // If userEmail specified, check it matches
    if (userEmail && token.email && token.email !== userEmail) {
      console.log(`[TokenStorage] Token file email mismatch: ${token.email} !== ${userEmail}`);
      return null;
    }

    return {
      userEmail: email,
      accessToken: token.access_token || token.token,
      refreshToken: token.refresh_token,
      tokenExpiry: getExpiryDate(token),
      scopes: token.scope || token.scopes?.join(' ')
    };
  } catch (error) {
    console.error('[TokenStorage] Error reading token file:', error);
    return null;
  }
}

/**
 * Migrate token from file to database.
 */
export async function migrateFileTokenToDatabase(): Promise<boolean> {
  if (!USE_DATABASE_TOKENS) {
    return false;
  }

  const fileToken = getTokenFromFile();
  if (!fileToken) {
    console.log('[TokenStorage] No file token to migrate');
    return false;
  }

  try {
    await saveToken(fileToken.userEmail, {
      access_token: fileToken.accessToken,
      refresh_token: fileToken.refreshToken,
      expiry_date: fileToken.tokenExpiry.getTime(),
      scope: fileToken.scopes
    });

    console.log(`[TokenStorage] Migrated token from file to database for: ${fileToken.userEmail}`);

    // Optionally backup and remove the file
    const backupPath = TOKEN_PATH + '.backup';
    fs.copyFileSync(TOKEN_PATH, backupPath);
    console.log(`[TokenStorage] Backed up token.json to ${backupPath}`);

    return true;
  } catch (error) {
    console.error('[TokenStorage] Error migrating token:', error);
    return false;
  }
}
