/**
 * Gmail Service
 *
 * Handles Gmail API authentication and email fetching.
 * Supports multi-user token storage via database (ADR-002).
 */

import fs from 'fs';
import path from 'path';
import { google, gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { EmailData } from '../types/index.js';
import { classifyEmail } from './classification.js';
import {
  saveToken,
  getToken,
  deleteToken,
  hasValidToken,
  getAnyValidToken,
  toGoogleToken,
  type StoredToken,
  type GoogleToken
} from './tokenStorage.js';

const SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/contacts.readonly'
];
const PROJECT_ROOT = process.cwd();
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const TOKEN_PATH = path.join(DATA_DIR, 'token.json');
const CREDENTIALS_PATH = path.join(DATA_DIR, 'credentials.json');
const BATCH_SIZE = 100;

// Cache Gmail service per user
const gmailServiceCache: Map<string, gmail_v1.Gmail> = new Map();
let cachedOAuth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;

// Current user context (set by auth middleware)
let currentUserEmail: string | null = null;

const REDIRECT_URI = "http://localhost:5000/auth/callback";

/**
 * Set current user context for Gmail operations.
 * Called by routes after authentication.
 */
export function setCurrentUser(email: string): void {
  currentUserEmail = email;
}

/**
 * Get current user email.
 */
export function getCurrentUser(): string | null {
  return currentUserEmail;
}

/**
 * Extract email address from a header like 'Name <email@domain.com>'.
 */
function extractEmailAddress(headerValue: string): string {
  if (!headerValue) return '';
  const match = headerValue.match(/<(.+?)>/);
  return match ? match[1] : headerValue.trim();
}

// NO PARSING IN TYPESCRIPT - SQL handles all domain extraction

/**
 * Get a header value by name from message headers.
 */
function getHeaderValue(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string {
  const header = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value ?? '';
}


/**
 * Get token expiry time in milliseconds.
 * Handles both 'expiry_date' (number) and 'expiry' (ISO string) formats.
 */
function getTokenExpiry(token: Record<string, unknown>): number | null {
  if (token.expiry_date && typeof token.expiry_date === 'number') {
    return token.expiry_date;
  }
  if (token.expiry && typeof token.expiry === 'string') {
    return new Date(token.expiry).getTime();
  }
  return null;
}

/**
 * Get or create OAuth2 client.
 */
export function getOAuth2Client(): InstanceType<typeof google.auth.OAuth2> {
  if (cachedOAuth2Client) {
    return cachedOAuth2Client;
  }
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error('credentials.json not found');
  }
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const { client_id, client_secret } = credentials.installed || credentials.web;
  cachedOAuth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
  return cachedOAuth2Client;
}

/**
 * Check if user is authenticated (has valid token).
 * For backwards compatibility, checks file-based token synchronously.
 * Use isAuthenticatedAsync for database-based checks.
 */
export function isAuthenticated(): { authenticated: boolean; email?: string } {
  // Synchronous check using file (for backwards compatibility)
  if (!fs.existsSync(TOKEN_PATH)) {
    return { authenticated: false };
  }
  try {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    const expiry = getTokenExpiry(token);
    if (expiry && Date.now() >= expiry - 5 * 60 * 1000) {
      if (!token.refresh_token) {
        return { authenticated: false };
      }
    }
    const email = token.email || token.account || undefined;
    return { authenticated: true, email };
  } catch {
    return { authenticated: false };
  }
}

/**
 * Check if user is authenticated (async, uses database).
 */
export async function isAuthenticatedAsync(userEmail?: string): Promise<{ authenticated: boolean; email?: string }> {
  try {
    // If specific user provided, check their token
    if (userEmail) {
      const hasToken = await hasValidToken(userEmail);
      return { authenticated: hasToken, email: userEmail };
    }

    // Otherwise, check for any valid token
    const token = await getAnyValidToken();
    if (token) {
      return { authenticated: true, email: token.userEmail };
    }

    // Fallback to file-based check
    return isAuthenticated();
  } catch (error) {
    console.error('Error checking authentication:', error);
    return isAuthenticated();
  }
}

/**
 * Get OAuth URL for user to authorize.
 */
export function getAuthUrl(): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
}

/**
 * Handle OAuth callback - exchange code for tokens.
 * Saves tokens to both database and file (for backwards compatibility).
 */
export async function handleAuthCallback(code: string): Promise<{ success: boolean; email?: string; error?: string }> {
  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    // Save to file for backwards compatibility
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    oauth2Client.setCredentials(tokens);

    // Clear cached service
    gmailServiceCache.clear();

    // Get user email from Gmail profile
    let email: string | undefined;
    try {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client as unknown as OAuth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      email = profile.data.emailAddress || undefined;

      if (email) {
        // Update file with email
        const updatedTokens = { ...tokens, email };
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedTokens, null, 2));

        // Save to database
        await saveToken(email, tokens as GoogleToken);
        console.log(`[Gmail] Saved token to database for: ${email}`);
      }
    } catch (profileError) {
      console.error('Error getting Gmail profile:', profileError);
    }

    return { success: true, email };
  } catch (error) {
    console.error('Error handling auth callback:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Clear authentication (logout).
 * Removes token from both database and file.
 */
export async function clearAuth(userEmail?: string): Promise<void> {
  // Clear from database if user email provided
  if (userEmail) {
    try {
      await deleteToken(userEmail);
      console.log(`[Gmail] Deleted token from database for: ${userEmail}`);
    } catch (error) {
      console.error('Error deleting token from database:', error);
    }
  }

  // Clear from file
  if (fs.existsSync(TOKEN_PATH)) {
    fs.unlinkSync(TOKEN_PATH);
  }

  // Clear caches
  gmailServiceCache.clear();
  cachedOAuth2Client = null;
  currentUserEmail = null;
}

/**
 * Get or create Gmail API service for a specific user.
 * Uses database token storage with file fallback.
 */
export async function getGmailService(userEmail?: string): Promise<gmail_v1.Gmail> {
  const effectiveEmail = userEmail || currentUserEmail;

  // Check cache first
  if (effectiveEmail && gmailServiceCache.has(effectiveEmail)) {
    return gmailServiceCache.get(effectiveEmail)!;
  }

  const oauth2Client = getOAuth2Client();

  // Try to get token from database first
  let storedToken: StoredToken | null = null;
  if (effectiveEmail) {
    storedToken = await getToken(effectiveEmail);
  }

  // Fallback to any valid token
  if (!storedToken) {
    storedToken = await getAnyValidToken();
  }

  // Final fallback to file
  if (!storedToken) {
    if (!fs.existsSync(TOKEN_PATH)) {
      throw new Error('NOT_AUTHENTICATED');
    }
    const fileToken = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oauth2Client.setCredentials(fileToken);

    // Check if token needs refresh
    const expiry = getTokenExpiry(fileToken);
    if (expiry && Date.now() >= expiry) {
      await refreshAndSaveToken(oauth2Client, fileToken.email);
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client as unknown as OAuth2Client });
    return gmail;
  }

  // Use database token
  const googleToken = toGoogleToken(storedToken);
  oauth2Client.setCredentials(googleToken);

  // Check if token needs refresh
  if (storedToken.tokenExpiry && Date.now() >= storedToken.tokenExpiry.getTime()) {
    await refreshAndSaveToken(oauth2Client, storedToken.userEmail);
  }

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client as unknown as OAuth2Client });

  // Cache the service
  if (storedToken.userEmail) {
    gmailServiceCache.set(storedToken.userEmail, gmail);
  }

  return gmail;
}

/**
 * Refresh token and save to both database and file.
 */
async function refreshAndSaveToken(oauth2Client: InstanceType<typeof google.auth.OAuth2>, userEmail?: string): Promise<void> {
  try {
    const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(newCredentials);

    // Save to file
    const updatedCredentials = { ...newCredentials, email: userEmail };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedCredentials, null, 2));

    // Save to database
    if (userEmail) {
      await saveToken(userEmail, newCredentials as GoogleToken);
    }

    console.log(`[Gmail] Token refreshed for: ${userEmail || 'unknown'}`);
  } catch (error) {
    console.error('Error refreshing token:', error);
    throw new Error('TOKEN_EXPIRED');
  }
}

/**
 * Fetch all unread emails using pagination.
 */
export async function fetchAllUnreadEmails(
  onProgress?: (count: number) => void,
  maxEmails?: number
): Promise<EmailData[]> {
  const gmail = await getGmailService();
  const emailDetails: EmailData[] = [];
  let pageToken: string | undefined;
  let totalFetched = 0;

  console.log('Searching for ALL unread emails (with pagination)...');

  while (true) {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: BATCH_SIZE,
      pageToken
    });

    const messages = response.data.messages;
    if (!messages || messages.length === 0) {
      break;
    }

    console.log(`Fetched batch of ${messages.length} message IDs...`);

    // Process each message
    for (const msgInfo of messages) {
      if (maxEmails && totalFetched >= maxEmails) {
        console.log(`Reached max limit of ${maxEmails} emails.`);
        return emailDetails;
      }

      try {
        const message = await gmail.users.messages.get({
          userId: 'me',
          id: msgInfo.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date']
        });

        const headers = message.data.payload?.headers ?? [];

        const fromHeader = getHeaderValue(headers, 'From');
        const email = extractEmailAddress(fromHeader);
        // NO PARSING - subdomain/primaryDomain will come from SQL

        const toHeader = getHeaderValue(headers, 'To');
        const toEmails = toHeader
          ? toHeader.split(',').map(e => extractEmailAddress(e.trim())).join(', ')
          : '';

        const ccHeader = getHeaderValue(headers, 'Cc');
        const ccEmails = ccHeader
          ? ccHeader.split(',').map(e => extractEmailAddress(e.trim())).join(', ')
          : '';

        const subject = getHeaderValue(headers, 'Subject');
        const date = getHeaderValue(headers, 'Date');

        // Classify the email by subject
        const classification = classifyEmail(subject);

        emailDetails.push({
          id: msgInfo.id!,
          email,
          from: fromHeader,
          subdomain: '',  // Will be populated by SQL
          primaryDomain: '',  // Will be populated by SQL
          subject,
          toEmails,
          ccEmails,
          date,
          category: classification.category,
          categoryIcon: classification.icon,
          categoryColor: classification.color,
          categoryBg: classification.bgColor,
          matchedKeyword: classification.matchedKeyword
        });

        totalFetched++;

        if (totalFetched % 100 === 0) {
          console.log(`Processed ${totalFetched} emails...`);
          onProgress?.(totalFetched);
        }
      } catch (error) {
        console.warn(`Error fetching message ${msgInfo.id}:`, error);
        continue;
      }
    }

    // Check for next page
    pageToken = response.data.nextPageToken ?? undefined;
    if (!pageToken) {
      break;
    }
  }

  console.log(`Successfully extracted details for ${emailDetails.length} emails.`);
  return emailDetails;
}

/**
 * Result type for trash operations with error details.
 */
export interface TrashResult {
  success: boolean;
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Delete emails by moving them to trash.
 * Returns error details if deletion fails.
 */
export async function trashEmail(messageId: string): Promise<TrashResult> {
  try {
    const gmail = await getGmailService();
    await gmail.users.messages.trash({
      userId: 'me',
      id: messageId
    });
    return { success: true };
  } catch (error: unknown) {
    // Extract error code and message from Gmail API error
    const apiError = error as { response?: { status?: number }; code?: number; message?: string };
    const code = apiError?.response?.status || apiError?.code || 500;
    const message = apiError?.message || 'Unknown error';
    console.error(`Error trashing message ${messageId}: [${code}] ${message}`);
    return {
      success: false,
      error: { code, message }
    };
  }
}

/**
 * Delete all unread promotional and social emails.
 * Uses Gmail's built-in category:promotions and category:social labels.
 */
export async function deletePromotionalEmails(
  dryRun = false
): Promise<{ count: number; deleted: number; errors: number }> {
  const gmail = await getGmailService();
  const query = 'category:promotions OR category:social is:unread';
  let count = 0;
  let deleted = 0;
  let errors = 0;
  let pageToken: string | undefined;

  console.log(`Searching for promotional/social emails: ${query}`);

  while (true) {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 500,
      pageToken
    });

    const messages = response.data.messages;
    if (!messages || messages.length === 0) {
      break;
    }

    count += messages.length;

    if (!dryRun) {
      // Batch trash messages
      for (const msg of messages) {
        try {
          await gmail.users.messages.trash({
            userId: 'me',
            id: msg.id!
          });
          deleted++;
        } catch (error) {
          console.error(`Error trashing promotional message ${msg.id}:`, error);
          errors++;
        }
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
    if (!pageToken) {
      break;
    }
  }

  console.log(`Promotional emails: found ${count}, deleted ${deleted}, errors ${errors}`);
  return { count, deleted: dryRun ? 0 : deleted, errors };
}

/**
 * Empty the spam folder by trashing all spam emails.
 */
export async function emptySpamFolder(
  dryRun = false
): Promise<{ count: number; deleted: number; errors: number }> {
  const gmail = await getGmailService();
  const query = 'in:spam';
  let count = 0;
  let deleted = 0;
  let errors = 0;
  let pageToken: string | undefined;

  console.log(`Searching for spam emails: ${query}`);

  while (true) {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 500,
      pageToken
    });

    const messages = response.data.messages;
    if (!messages || messages.length === 0) {
      break;
    }

    count += messages.length;

    if (!dryRun) {
      // Permanently delete spam (not just trash)
      const messageIds = messages.map(m => m.id!);
      try {
        await gmail.users.messages.batchDelete({
          userId: 'me',
          requestBody: { ids: messageIds }
        });
        deleted += messageIds.length;
      } catch (error) {
        console.error('Error batch deleting spam:', error);
        // Fall back to individual deletion
        for (const msg of messages) {
          try {
            await gmail.users.messages.delete({
              userId: 'me',
              id: msg.id!
            });
            deleted++;
          } catch (err) {
            console.error(`Error deleting spam message ${msg.id}:`, err);
            errors++;
          }
        }
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
    if (!pageToken) {
      break;
    }
  }

  console.log(`Spam emails: found ${count}, deleted ${deleted}, errors ${errors}`);
  return { count, deleted: dryRun ? 0 : deleted, errors };
}

/**
 * Fetch read emails for analysis (testing purposes).
 * Unlike fetchAllUnreadEmails, this fetches already-read emails.
 */
export async function fetchReadEmails(
  maxEmails: number = 500,
  onProgress?: (count: number) => void
): Promise<EmailData[]> {
  const gmail = await getGmailService();
  const emailDetails: EmailData[] = [];
  let pageToken: string | undefined;
  let totalFetched = 0;

  console.log(`Fetching up to ${maxEmails} READ emails for analysis...`);

  while (totalFetched < maxEmails) {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:read',  // Only read emails
      maxResults: Math.min(BATCH_SIZE, maxEmails - totalFetched),
      pageToken
    });

    const messages = response.data.messages;
    if (!messages || messages.length === 0) {
      break;
    }

    console.log(`Fetched batch of ${messages.length} message IDs...`);

    // Process each message
    for (const msgInfo of messages) {
      if (totalFetched >= maxEmails) {
        break;
      }

      try {
        const message = await gmail.users.messages.get({
          userId: 'me',
          id: msgInfo.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date']
        });

        const headers = message.data.payload?.headers ?? [];

        const fromHeader = getHeaderValue(headers, 'From');
        const email = extractEmailAddress(fromHeader);

        const toHeader = getHeaderValue(headers, 'To');
        const toEmails = toHeader
          ? toHeader.split(',').map(e => extractEmailAddress(e.trim())).join(', ')
          : '';

        const ccHeader = getHeaderValue(headers, 'Cc');
        const ccEmails = ccHeader
          ? ccHeader.split(',').map(e => extractEmailAddress(e.trim())).join(', ')
          : '';

        const subject = getHeaderValue(headers, 'Subject');
        const date = getHeaderValue(headers, 'Date');

        // Classify the email by subject
        const classification = classifyEmail(subject);

        emailDetails.push({
          id: msgInfo.id!,
          email,
          from: fromHeader,
          subdomain: '',  // Will be populated by SQL
          primaryDomain: '',  // Will be populated by SQL
          subject,
          toEmails,
          ccEmails,
          date,
          category: classification.category,
          categoryIcon: classification.icon,
          categoryColor: classification.color,
          categoryBg: classification.bgColor,
          matchedKeyword: classification.matchedKeyword
        });

        totalFetched++;

        if (totalFetched % 100 === 0) {
          console.log(`Processed ${totalFetched} emails...`);
          onProgress?.(totalFetched);
        }
      } catch (error) {
        console.warn(`Error fetching message ${msgInfo.id}:`, error);
        continue;
      }
    }

    // Check for next page
    pageToken = response.data.nextPageToken ?? undefined;
    if (!pageToken) {
      break;
    }
  }

  console.log(`Successfully fetched ${emailDetails.length} READ emails.`);
  return emailDetails;
}

/**
 * Generate Gmail URL for viewing emails.
 */
export function getGmailUrl(
  messageIds: string[],
  domain: string,
  subject: string
): string {
  const baseUrl = 'https://mail.google.com/mail/u/0/';

  if (messageIds.length === 1) {
    // Single email: direct link
    return `${baseUrl}#inbox/${messageIds[0]}`;
  } else {
    // Multiple emails: search query
    const query = `from:${domain} subject:"${subject.slice(0, 50)}"`;
    return `${baseUrl}#search/${encodeURIComponent(query)}`;
  }
}
