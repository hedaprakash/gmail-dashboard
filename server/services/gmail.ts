/**
 * Gmail Service
 *
 * Handles Gmail API authentication and email fetching.
 */

import fs from 'fs';
import path from 'path';
import { google, gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { EmailData } from '../types/index.js';
import { classifyEmail } from './classification.js';

const SCOPES = ['https://mail.google.com/'];
const PROJECT_ROOT = process.cwd();
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const TOKEN_PATH = path.join(DATA_DIR, 'token.json');
const CREDENTIALS_PATH = path.join(DATA_DIR, 'credentials.json');
const BATCH_SIZE = 100;

let gmailService: gmail_v1.Gmail | null = null;
let cachedOAuth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;

const REDIRECT_URI = "http://localhost:5000/auth/callback";

/**
 * Extract email address from a header like 'Name <email@domain.com>'.
 */
function extractEmailAddress(headerValue: string): string {
  if (!headerValue) return '';
  const match = headerValue.match(/<(.+?)>/);
  return match ? match[1] : headerValue.trim();
}

// Two-level TLDs that require taking 3 parts for primary domain
const TWO_LEVEL_TLDS = new Set([
  'co.in', 'co.uk', 'co.nz', 'co.za', 'co.jp', 'co.kr',
  'com.au', 'com.br', 'com.mx', 'com.sg', 'com.hk', 'com.tw',
  'org.uk', 'org.au', 'org.in',
  'net.au', 'net.in',
  'gov.uk', 'gov.in',
  'ac.uk', 'ac.in',
  'edu.au', 'edu.in'
]);

/**
 * Extract subdomain and primary domain from email address.
 * Handles two-level TLDs like .co.in, .co.uk, .com.au correctly.
 */
function extractDomainInfo(email: string): { subdomain: string; primaryDomain: string } {
  if (!email.includes('@')) {
    return { subdomain: '', primaryDomain: '' };
  }
  const fullDomain = email.split('@')[1] ?? '';
  const parts = fullDomain.split('.');

  if (parts.length < 2) {
    return { subdomain: fullDomain, primaryDomain: fullDomain };
  }

  // Check if last two parts form a two-level TLD
  const lastTwo = parts.slice(-2).join('.').toLowerCase();
  let primaryDomain: string;

  if (TWO_LEVEL_TLDS.has(lastTwo) && parts.length >= 3) {
    // Two-level TLD: take last 3 parts (e.g., sbi.co.in)
    primaryDomain = parts.slice(-3).join('.');
  } else {
    // Standard TLD: take last 2 parts (e.g., google.com)
    primaryDomain = parts.slice(-2).join('.');
  }

  return { subdomain: fullDomain, primaryDomain };
}

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
function getOAuth2Client(): InstanceType<typeof google.auth.OAuth2> {
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
 */
export function isAuthenticated(): { authenticated: boolean; email?: string } {
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
 */
export async function handleAuthCallback(code: string): Promise<{ success: boolean; email?: string; error?: string }> {
  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    oauth2Client.setCredentials(tokens);
    gmailService = null;
    let email: string | undefined;
    try {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client as unknown as OAuth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      email = profile.data.emailAddress || undefined;
      const updatedTokens = { ...tokens, email };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedTokens, null, 2));
    } catch { }
    return { success: true, email };
  } catch (error) {
    console.error('Error handling auth callback:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Clear authentication (logout).
 */
export function clearAuth(): void {
  if (fs.existsSync(TOKEN_PATH)) {
    fs.unlinkSync(TOKEN_PATH);
  }
  gmailService = null;
  cachedOAuth2Client = null;
}

/**
 * Get or create Gmail API service.
 */
export async function getGmailService(): Promise<gmail_v1.Gmail> {
  if (gmailService) {
    return gmailService;
  }

  const oauth2Client = getOAuth2Client();

  // Load token
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error('NOT_AUTHENTICATED');
  }

  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  oauth2Client.setCredentials(token);

  // Check if token needs refresh (handles both expiry and expiry_date)
  const expiry = getTokenExpiry(token);
  if (expiry && Date.now() >= expiry) {
    try {
      const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(newCredentials);
      const updatedCredentials = { ...newCredentials, email: token.email };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedCredentials, null, 2));
      console.log('Token refreshed');
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw new Error('TOKEN_EXPIRED');
    }
  }

  gmailService = google.gmail({ version: 'v1', auth: oauth2Client as unknown as OAuth2Client });
  return gmailService;
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
        const { subdomain, primaryDomain } = extractDomainInfo(email);

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
          subdomain,
          primaryDomain,
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
 * Delete emails by moving them to trash.
 */
export async function trashEmail(messageId: string): Promise<boolean> {
  try {
    const gmail = await getGmailService();
    await gmail.users.messages.trash({
      userId: 'me',
      id: messageId
    });
    return true;
  } catch (error) {
    console.error(`Error trashing message ${messageId}:`, error);
    return false;
  }
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
