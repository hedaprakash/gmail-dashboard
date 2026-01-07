-- ============================================================================
-- Google Contacts Tables
--
-- Creates tables for storing synced Google Contacts data.
-- Supports multi-user with user_email column.
-- ============================================================================

USE GmailCriteria;
GO

-- ============================================================================
-- Drop existing tables if they exist (in correct order for FK constraints)
-- ============================================================================
IF OBJECT_ID('contact_phones', 'U') IS NOT NULL DROP TABLE contact_phones;
IF OBJECT_ID('contact_emails', 'U') IS NOT NULL DROP TABLE contact_emails;
IF OBJECT_ID('contacts', 'U') IS NOT NULL DROP TABLE contacts;
GO

-- ============================================================================
-- Main contacts table
-- ============================================================================
CREATE TABLE contacts (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_email NVARCHAR(255) NOT NULL,
    google_resource_name NVARCHAR(100) NOT NULL,  -- 'people/c123456789'
    etag NVARCHAR(100),                           -- For sync conflict detection
    display_name NVARCHAR(255),
    given_name NVARCHAR(100),
    family_name NVARCHAR(100),
    photo_url NVARCHAR(500),
    organization NVARCHAR(255),
    job_title NVARCHAR(255),
    notes NVARCHAR(MAX),
    birthday NVARCHAR(20),                        -- 'YYYY-MM-DD' format
    last_synced DATETIME2 DEFAULT GETDATE(),
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE(),

    -- Each contact is unique per user
    CONSTRAINT UQ_contact_resource_user UNIQUE(google_resource_name, user_email)
);
GO

-- ============================================================================
-- Contact emails table (one-to-many)
-- ============================================================================
CREATE TABLE contact_emails (
    id INT IDENTITY(1,1) PRIMARY KEY,
    contact_id INT NOT NULL,
    email NVARCHAR(255) NOT NULL,
    type NVARCHAR(50),           -- 'home', 'work', 'other'
    is_primary BIT DEFAULT 0,

    CONSTRAINT FK_contact_emails_contact
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);
GO

-- ============================================================================
-- Contact phone numbers table (one-to-many)
-- ============================================================================
CREATE TABLE contact_phones (
    id INT IDENTITY(1,1) PRIMARY KEY,
    contact_id INT NOT NULL,
    phone NVARCHAR(50) NOT NULL,
    type NVARCHAR(50),           -- 'mobile', 'home', 'work'
    is_primary BIT DEFAULT 0,

    CONSTRAINT FK_contact_phones_contact
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);
GO

-- ============================================================================
-- Indexes for performance
-- ============================================================================

-- User filtering (most common query pattern)
CREATE INDEX idx_contacts_user_email ON contacts(user_email);

-- Name search
CREATE INDEX idx_contacts_display_name ON contacts(display_name);

-- Email lookup (for cross-referencing with pending_emails)
CREATE INDEX idx_contact_emails_email ON contact_emails(email);

-- Contact ID foreign key
CREATE INDEX idx_contact_emails_contact_id ON contact_emails(contact_id);
CREATE INDEX idx_contact_phones_contact_id ON contact_phones(contact_id);

-- Last synced for finding stale contacts
CREATE INDEX idx_contacts_last_synced ON contacts(last_synced);

GO

-- ============================================================================
-- Stored Procedure: Upsert Contact
-- Inserts or updates a contact based on google_resource_name
-- ============================================================================
CREATE OR ALTER PROCEDURE dbo.UpsertContact
    @UserEmail NVARCHAR(255),
    @GoogleResourceName NVARCHAR(100),
    @Etag NVARCHAR(100) = NULL,
    @DisplayName NVARCHAR(255) = NULL,
    @GivenName NVARCHAR(100) = NULL,
    @FamilyName NVARCHAR(100) = NULL,
    @PhotoUrl NVARCHAR(500) = NULL,
    @Organization NVARCHAR(255) = NULL,
    @JobTitle NVARCHAR(255) = NULL,
    @Notes NVARCHAR(MAX) = NULL,
    @Birthday NVARCHAR(20) = NULL,
    @ContactId INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    -- Check if contact exists
    SELECT @ContactId = id
    FROM contacts
    WHERE google_resource_name = @GoogleResourceName
      AND user_email = @UserEmail;

    IF @ContactId IS NULL
    BEGIN
        -- Insert new contact
        INSERT INTO contacts (
            user_email, google_resource_name, etag, display_name,
            given_name, family_name, photo_url, organization,
            job_title, notes, birthday, last_synced
        )
        VALUES (
            @UserEmail, @GoogleResourceName, @Etag, @DisplayName,
            @GivenName, @FamilyName, @PhotoUrl, @Organization,
            @JobTitle, @Notes, @Birthday, GETDATE()
        );

        SET @ContactId = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        -- Update existing contact
        UPDATE contacts
        SET etag = @Etag,
            display_name = @DisplayName,
            given_name = @GivenName,
            family_name = @FamilyName,
            photo_url = @PhotoUrl,
            organization = @Organization,
            job_title = @JobTitle,
            notes = @Notes,
            birthday = @Birthday,
            last_synced = GETDATE(),
            updated_at = GETDATE()
        WHERE id = @ContactId;

        -- Clear existing emails and phones (will be re-added)
        DELETE FROM contact_emails WHERE contact_id = @ContactId;
        DELETE FROM contact_phones WHERE contact_id = @ContactId;
    END
END
GO

-- ============================================================================
-- Stored Procedure: Add Contact Email
-- ============================================================================
CREATE OR ALTER PROCEDURE dbo.AddContactEmail
    @ContactId INT,
    @Email NVARCHAR(255),
    @Type NVARCHAR(50) = NULL,
    @IsPrimary BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO contact_emails (contact_id, email, type, is_primary)
    VALUES (@ContactId, @Email, @Type, @IsPrimary);
END
GO

-- ============================================================================
-- Stored Procedure: Add Contact Phone
-- ============================================================================
CREATE OR ALTER PROCEDURE dbo.AddContactPhone
    @ContactId INT,
    @Phone NVARCHAR(50),
    @Type NVARCHAR(50) = NULL,
    @IsPrimary BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO contact_phones (contact_id, phone, type, is_primary)
    VALUES (@ContactId, @Phone, @Type, @IsPrimary);
END
GO

-- ============================================================================
-- Stored Procedure: Get Contacts with Emails
-- Returns contacts with their primary email for list view
-- ============================================================================
CREATE OR ALTER PROCEDURE dbo.GetContactsForUser
    @UserEmail NVARCHAR(255),
    @SearchTerm NVARCHAR(100) = NULL,
    @Offset INT = 0,
    @Limit INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        c.id,
        c.google_resource_name,
        c.display_name,
        c.given_name,
        c.family_name,
        c.photo_url,
        c.organization,
        c.job_title,
        c.last_synced,
        (SELECT TOP 1 email FROM contact_emails WHERE contact_id = c.id AND is_primary = 1) as primary_email,
        (SELECT TOP 1 phone FROM contact_phones WHERE contact_id = c.id AND is_primary = 1) as primary_phone,
        (SELECT COUNT(*) FROM contact_emails WHERE contact_id = c.id) as email_count,
        (SELECT COUNT(*) FROM contact_phones WHERE contact_id = c.id) as phone_count
    FROM contacts c
    WHERE c.user_email = @UserEmail
      AND (@SearchTerm IS NULL
           OR c.display_name LIKE '%' + @SearchTerm + '%'
           OR c.organization LIKE '%' + @SearchTerm + '%'
           OR EXISTS (SELECT 1 FROM contact_emails WHERE contact_id = c.id AND email LIKE '%' + @SearchTerm + '%'))
    ORDER BY c.display_name
    OFFSET @Offset ROWS
    FETCH NEXT @Limit ROWS ONLY;

    -- Also return total count
    SELECT COUNT(*) as total_count
    FROM contacts c
    WHERE c.user_email = @UserEmail
      AND (@SearchTerm IS NULL
           OR c.display_name LIKE '%' + @SearchTerm + '%'
           OR c.organization LIKE '%' + @SearchTerm + '%'
           OR EXISTS (SELECT 1 FROM contact_emails WHERE contact_id = c.id AND email LIKE '%' + @SearchTerm + '%'));
END
GO

-- ============================================================================
-- Stored Procedure: Get Contact Details
-- Returns full contact info with all emails and phones
-- ============================================================================
CREATE OR ALTER PROCEDURE dbo.GetContactDetails
    @ContactId INT,
    @UserEmail NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    -- Contact info
    SELECT
        c.*,
        (SELECT COUNT(*) FROM pending_emails pe
         WHERE pe.user_email = @UserEmail
         AND EXISTS (SELECT 1 FROM contact_emails ce WHERE ce.contact_id = c.id AND pe.from_email LIKE '%' + ce.email + '%')
        ) as email_count_from_contact
    FROM contacts c
    WHERE c.id = @ContactId AND c.user_email = @UserEmail;

    -- All emails
    SELECT id, email, type, is_primary
    FROM contact_emails
    WHERE contact_id = @ContactId
    ORDER BY is_primary DESC, email;

    -- All phones
    SELECT id, phone, type, is_primary
    FROM contact_phones
    WHERE contact_id = @ContactId
    ORDER BY is_primary DESC, phone;
END
GO

-- ============================================================================
-- Stored Procedure: Find Contact by Email
-- Useful for cross-referencing emails in pending_emails
-- ============================================================================
CREATE OR ALTER PROCEDURE dbo.FindContactByEmail
    @UserEmail NVARCHAR(255),
    @EmailToFind NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        c.id,
        c.display_name,
        c.photo_url,
        c.organization,
        ce.email as matched_email,
        ce.type as email_type
    FROM contacts c
    INNER JOIN contact_emails ce ON c.id = ce.contact_id
    WHERE c.user_email = @UserEmail
      AND LOWER(ce.email) = LOWER(@EmailToFind);
END
GO

-- ============================================================================
-- Stored Procedure: Get Contact Statistics
-- ============================================================================
CREATE OR ALTER PROCEDURE dbo.GetContactStats
    @UserEmail NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        (SELECT COUNT(*) FROM contacts WHERE user_email = @UserEmail) as total_contacts,
        (SELECT COUNT(*) FROM contacts WHERE user_email = @UserEmail AND organization IS NOT NULL AND organization != '') as with_organization,
        (SELECT COUNT(DISTINCT ce.email) FROM contact_emails ce
         INNER JOIN contacts c ON ce.contact_id = c.id
         WHERE c.user_email = @UserEmail) as total_emails,
        (SELECT COUNT(DISTINCT cp.phone) FROM contact_phones cp
         INNER JOIN contacts c ON cp.contact_id = c.id
         WHERE c.user_email = @UserEmail) as total_phones,
        (SELECT MIN(last_synced) FROM contacts WHERE user_email = @UserEmail) as oldest_sync,
        (SELECT MAX(last_synced) FROM contacts WHERE user_email = @UserEmail) as newest_sync;
END
GO

-- ============================================================================
-- Verification
-- ============================================================================
PRINT 'Contacts tables and procedures created successfully';
PRINT '';
PRINT 'Tables:';
PRINT '  - contacts';
PRINT '  - contact_emails';
PRINT '  - contact_phones';
PRINT '';
PRINT 'Stored Procedures:';
PRINT '  - UpsertContact';
PRINT '  - AddContactEmail';
PRINT '  - AddContactPhone';
PRINT '  - GetContactsForUser';
PRINT '  - GetContactDetails';
PRINT '  - FindContactByEmail';
PRINT '  - GetContactStats';
GO
