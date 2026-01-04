const fs = require('fs');
const filepath = 'server/services/gmail.ts';
let content = fs.readFileSync(filepath, 'utf8');

const helperFunctions = `
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
`;

// Find the line with "Get or create Gmail API service" and insert before it
const insertPoint = content.indexOf('/**\n * Get or create Gmail API service.');
if (insertPoint === -1) {
  console.log('Could not find insertion point');
  process.exit(1);
}

content = content.slice(0, insertPoint) + helperFunctions + '\n' + content.slice(insertPoint);

fs.writeFileSync(filepath, content);
console.log('Added helper functions at line:', content.substring(0, insertPoint).split('\n').length);
