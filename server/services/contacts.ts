/**
 * Contacts Service
 *
 * Handles Google People API integration for syncing and managing contacts.
 */

import fs from 'fs';
import path from 'path';
import { google, people_v1 } from 'googleapis';
import { query, queryAll, queryOne } from './database.js';

const PROJECT_ROOT = process.cwd();
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const TOKEN_PATH = path.join(DATA_DIR, 'token.json');
const CREDENTIALS_PATH = path.join(DATA_DIR, 'credentials.json');
const REDIRECT_URI = "http://localhost:5000/auth/callback";

// Types for contacts
export interface Contact {
  id: number;
  googleResourceName: string;
  displayName: string | null;
  givenName: string | null;
  familyName: string | null;
  photoUrl: string | null;
  organization: string | null;
  jobTitle: string | null;
  notes: string | null;
  birthday: string | null;
  lastSynced: Date;
  primaryEmail: string | null;
  primaryPhone: string | null;
  emailCount: number;
  phoneCount: number;
}

export interface ContactDetails extends Contact {
  emails: Array<{ id: number; email: string; type: string | null; isPrimary: boolean }>;
  phones: Array<{ id: number; phone: string; type: string | null; isPrimary: boolean }>;
  emailCountFromContact: number;
}

export interface ContactStats {
  totalContacts: number;
  withOrganization: number;
  totalEmails: number;
  totalPhones: number;
  oldestSync: Date | null;
  newestSync: Date | null;
}

export interface SyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: number;
  errorMessages: string[];
}

// SQL row types (snake_case from database)
interface ContactRow {
  id: number;
  google_resource_name: string;
  display_name: string | null;
  given_name: string | null;
  family_name: string | null;
  photo_url: string | null;
  organization: string | null;
  job_title: string | null;
  notes: string | null;
  birthday: string | null;
  last_synced: Date;
  primary_email: string | null;
  primary_phone: string | null;
  email_count: number;
  phone_count: number;
  email_count_from_contact?: number;
}

interface ContactEmailRow {
  id: number;
  email: string;
  type: string | null;
  is_primary: boolean;
}

interface ContactPhoneRow {
  id: number;
  phone: string;
  type: string | null;
  is_primary: boolean;
}

let peopleService: people_v1.People | null = null;
let cachedOAuth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;

/**
 * Get or create OAuth2 client with loaded credentials.
 */
function getAuthenticatedClient(): InstanceType<typeof google.auth.OAuth2> {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error('credentials.json not found');
  }

  if (!cachedOAuth2Client) {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    const { client_id, client_secret } = credentials.installed || credentials.web;
    cachedOAuth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
  }

  // Load token
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error('NOT_AUTHENTICATED');
  }

  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  cachedOAuth2Client.setCredentials(token);

  return cachedOAuth2Client;
}

/**
 * Get or create the People API service.
 */
async function getPeopleService(): Promise<people_v1.People> {
  if (peopleService) {
    return peopleService;
  }

  const auth = getAuthenticatedClient();
  peopleService = google.people({ version: 'v1', auth });
  return peopleService;
}

/**
 * Sync contacts from Google People API to SQL Server.
 */
export async function syncContacts(
  userEmail: string,
  onProgress?: (current: number, total: number) => void
): Promise<SyncResult> {
  const result: SyncResult = {
    synced: 0,
    created: 0,
    updated: 0,
    errors: 0,
    errorMessages: []
  };

  try {
    const service = await getPeopleService();
    let pageToken: string | undefined;
    let totalFetched = 0;

    do {
      // Fetch connections (contacts)
      const response = await service.people.connections.list({
        resourceName: 'people/me',
        pageSize: 100,
        pageToken,
        personFields: 'names,emailAddresses,phoneNumbers,photos,organizations,biographies,birthdays'
      });

      const connections = response.data.connections || [];
      const totalResults = response.data.totalItems || connections.length;

      for (const person of connections) {
        try {
          await upsertContact(userEmail, person);
          result.synced++;

          // Check if this was a create or update
          const existing = await queryOne<{ id: number }>(
            `SELECT id FROM contacts WHERE google_resource_name = @resourceName AND user_email = @userEmail`,
            { resourceName: person.resourceName, userEmail }
          );
          if (existing) {
            result.updated++;
          } else {
            result.created++;
          }
        } catch (err) {
          result.errors++;
          result.errorMessages.push(
            `Failed to sync ${person.names?.[0]?.displayName || person.resourceName}: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        }

        totalFetched++;
        if (onProgress) {
          onProgress(totalFetched, totalResults);
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    console.log(`[${userEmail}] Synced ${result.synced} contacts (${result.created} created, ${result.updated} updated, ${result.errors} errors)`);
  } catch (error) {
    console.error('Error syncing contacts:', error);
    throw error;
  }

  return result;
}

/**
 * Upsert a single contact from Google People API data.
 */
async function upsertContact(userEmail: string, person: people_v1.Schema$Person): Promise<number> {
  const resourceName = person.resourceName;
  if (!resourceName) {
    throw new Error('Contact missing resourceName');
  }

  // Extract primary name
  const primaryName = person.names?.find(n => n.metadata?.primary) || person.names?.[0];
  const displayName = primaryName?.displayName || null;
  const givenName = primaryName?.givenName || null;
  const familyName = primaryName?.familyName || null;

  // Extract photo
  const primaryPhoto = person.photos?.find(p => p.metadata?.primary) || person.photos?.[0];
  const photoUrl = primaryPhoto?.url || null;

  // Extract organization
  const primaryOrg = person.organizations?.find(o => o.metadata?.primary) || person.organizations?.[0];
  const organization = primaryOrg?.name || null;
  const jobTitle = primaryOrg?.title || null;

  // Extract biography/notes
  const primaryBio = person.biographies?.find(b => b.metadata?.primary) || person.biographies?.[0];
  const notes = primaryBio?.value || null;

  // Extract birthday
  const primaryBirthday = person.birthdays?.find(b => b.metadata?.primary) || person.birthdays?.[0];
  let birthday: string | null = null;
  if (primaryBirthday?.date) {
    const { year, month, day } = primaryBirthday.date;
    if (month && day) {
      birthday = `${year || '----'}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Call stored procedure to upsert contact
  const upsertResult = await query<{ ContactId: number }>(
    `DECLARE @ContactId INT;
     EXEC dbo.UpsertContact
       @UserEmail = @userEmail,
       @GoogleResourceName = @resourceName,
       @Etag = @etag,
       @DisplayName = @displayName,
       @GivenName = @givenName,
       @FamilyName = @familyName,
       @PhotoUrl = @photoUrl,
       @Organization = @organization,
       @JobTitle = @jobTitle,
       @Notes = @notes,
       @Birthday = @birthday,
       @ContactId = @ContactId OUTPUT;
     SELECT @ContactId as ContactId;`,
    {
      userEmail,
      resourceName,
      etag: person.etag || null,
      displayName,
      givenName,
      familyName,
      photoUrl,
      organization,
      jobTitle,
      notes,
      birthday
    }
  );

  const contactId = upsertResult.recordset[0]?.ContactId;
  if (!contactId) {
    throw new Error('Failed to get contact ID from upsert');
  }

  // Add emails
  for (const email of person.emailAddresses || []) {
    if (email.value) {
      await query(
        `EXEC dbo.AddContactEmail @ContactId = @contactId, @Email = @email, @Type = @type, @IsPrimary = @isPrimary`,
        {
          contactId,
          email: email.value,
          type: email.type || null,
          isPrimary: email.metadata?.primary ? 1 : 0
        }
      );
    }
  }

  // Add phones
  for (const phone of person.phoneNumbers || []) {
    if (phone.value) {
      await query(
        `EXEC dbo.AddContactPhone @ContactId = @contactId, @Phone = @phone, @Type = @type, @IsPrimary = @isPrimary`,
        {
          contactId,
          phone: phone.value,
          type: phone.type || null,
          isPrimary: phone.metadata?.primary ? 1 : 0
        }
      );
    }
  }

  return contactId;
}

/**
 * Get paginated list of contacts for a user.
 */
export async function getContacts(
  userEmail: string,
  searchTerm?: string,
  offset = 0,
  limit = 50
): Promise<{ contacts: Contact[]; total: number }> {
  const result = await query<ContactRow>(
    `EXEC dbo.GetContactsForUser @UserEmail = @userEmail, @SearchTerm = @searchTerm, @Offset = @offset, @Limit = @limit`,
    { userEmail, searchTerm: searchTerm || null, offset, limit }
  );

  // First recordset is contacts, second is total count
  const contactRows = result.recordsets[0] as ContactRow[] | undefined;
  const contacts: Contact[] = contactRows?.map(row => ({
    id: row.id,
    googleResourceName: row.google_resource_name,
    displayName: row.display_name,
    givenName: row.given_name,
    familyName: row.family_name,
    photoUrl: row.photo_url,
    organization: row.organization,
    jobTitle: row.job_title,
    notes: null,
    birthday: null,
    lastSynced: row.last_synced,
    primaryEmail: row.primary_email,
    primaryPhone: row.primary_phone,
    emailCount: row.email_count,
    phoneCount: row.phone_count
  })) || [];

  const totalRow = result.recordsets[1]?.[0] as unknown as { total_count: number } | undefined;
  const total = totalRow?.total_count || 0;

  return { contacts, total };
}

/**
 * Get detailed contact info including all emails and phones.
 */
export async function getContactDetails(
  contactId: number,
  userEmail: string
): Promise<ContactDetails | null> {
  const result = await query<ContactRow>(
    `EXEC dbo.GetContactDetails @ContactId = @contactId, @UserEmail = @userEmail`,
    { contactId, userEmail }
  );

  const contactRow = result.recordsets[0]?.[0] as ContactRow | undefined;
  if (!contactRow) {
    return null;
  }

  const emailRows = result.recordsets[1] as unknown as ContactEmailRow[] | undefined;
  const emails = emailRows?.map(row => ({
    id: row.id,
    email: row.email,
    type: row.type,
    isPrimary: row.is_primary
  })) || [];

  const phoneRows = result.recordsets[2] as unknown as ContactPhoneRow[] | undefined;
  const phones = phoneRows?.map(row => ({
    id: row.id,
    phone: row.phone,
    type: row.type,
    isPrimary: row.is_primary
  })) || [];

  return {
    id: contactRow.id,
    googleResourceName: contactRow.google_resource_name,
    displayName: contactRow.display_name,
    givenName: contactRow.given_name,
    familyName: contactRow.family_name,
    photoUrl: contactRow.photo_url,
    organization: contactRow.organization,
    jobTitle: contactRow.job_title,
    notes: contactRow.notes,
    birthday: contactRow.birthday,
    lastSynced: contactRow.last_synced,
    primaryEmail: emails.find(e => e.isPrimary)?.email || emails[0]?.email || null,
    primaryPhone: phones.find(p => p.isPrimary)?.phone || phones[0]?.phone || null,
    emailCount: emails.length,
    phoneCount: phones.length,
    emails,
    phones,
    emailCountFromContact: contactRow.email_count_from_contact || 0
  };
}

/**
 * Find contact by email address.
 */
export async function findContactByEmail(
  userEmail: string,
  emailToFind: string
): Promise<{ id: number; displayName: string; photoUrl: string | null; organization: string | null; matchedEmail: string } | null> {
  const result = await queryAll<{
    id: number;
    display_name: string;
    photo_url: string | null;
    organization: string | null;
    matched_email: string;
  }>(
    `EXEC dbo.FindContactByEmail @UserEmail = @userEmail, @EmailToFind = @emailToFind`,
    { userEmail, emailToFind }
  );

  if (result.length === 0) {
    return null;
  }

  const row = result[0];
  return {
    id: row.id,
    displayName: row.display_name,
    photoUrl: row.photo_url,
    organization: row.organization,
    matchedEmail: row.matched_email
  };
}

/**
 * Get contact statistics for a user.
 */
export async function getContactStats(userEmail: string): Promise<ContactStats> {
  const result = await queryOne<{
    total_contacts: number;
    with_organization: number;
    total_emails: number;
    total_phones: number;
    oldest_sync: Date | null;
    newest_sync: Date | null;
  }>(
    `EXEC dbo.GetContactStats @UserEmail = @userEmail`,
    { userEmail }
  );

  return {
    totalContacts: result?.total_contacts || 0,
    withOrganization: result?.with_organization || 0,
    totalEmails: result?.total_emails || 0,
    totalPhones: result?.total_phones || 0,
    oldestSync: result?.oldest_sync || null,
    newestSync: result?.newest_sync || null
  };
}

/**
 * Clear the People service cache (for re-auth).
 */
export function clearPeopleServiceCache(): void {
  peopleService = null;
}
