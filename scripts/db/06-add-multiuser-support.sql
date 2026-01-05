-- ============================================================================
-- Multi-User Support Migration
-- ============================================================================
-- This script adds user_email column to criteria and pending_emails tables
-- to support multiple users with isolated data.
--
-- Usage:
--   docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
--     -S localhost -U sa -P "MyPass@word123" -C -d GmailCriteria \
--     -i /scripts/06-add-multiuser-support.sql
-- ============================================================================

USE GmailCriteria;
GO

-- ============================================================================
-- Step 1: Add user_email column to criteria table
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('criteria') AND name = 'user_email')
BEGIN
    ALTER TABLE criteria ADD user_email NVARCHAR(255) NOT NULL DEFAULT 'default@user.com';
    PRINT 'Added user_email column to criteria table';
END
ELSE
BEGIN
    PRINT 'user_email column already exists in criteria table';
END
GO

-- Drop the old unique constraint on key_value alone
IF EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('criteria') AND name = 'UQ__criteria__key_value')
BEGIN
    ALTER TABLE criteria DROP CONSTRAINT UQ__criteria__key_value;
    PRINT 'Dropped old unique constraint on key_value';
END
GO

-- Create new composite unique constraint (key_value + user_email)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('criteria') AND name = 'UQ_criteria_key_user')
BEGIN
    -- First check if the default unique constraint exists and drop it
    DECLARE @constraintName NVARCHAR(255);
    SELECT @constraintName = name FROM sys.indexes
    WHERE object_id = OBJECT_ID('criteria') AND is_unique_constraint = 1 AND name LIKE 'UQ__criteria%';

    IF @constraintName IS NOT NULL
    BEGIN
        EXEC('ALTER TABLE criteria DROP CONSTRAINT ' + @constraintName);
        PRINT 'Dropped auto-generated unique constraint';
    END

    ALTER TABLE criteria ADD CONSTRAINT UQ_criteria_key_user UNIQUE (key_value, user_email);
    PRINT 'Created composite unique constraint on (key_value, user_email)';
END
GO

-- Create index on user_email for performance
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('criteria') AND name = 'idx_criteria_user_email')
BEGIN
    CREATE INDEX idx_criteria_user_email ON criteria(user_email);
    PRINT 'Created index on criteria.user_email';
END
GO

-- ============================================================================
-- Step 2: Create pending_emails table if not exists (with user_email)
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'pending_emails')
BEGIN
    CREATE TABLE pending_emails (
        id INT IDENTITY PRIMARY KEY,
        email_id NVARCHAR(100) NOT NULL,
        user_email NVARCHAR(255) NOT NULL,
        from_email NVARCHAR(255),
        to_email NVARCHAR(255),
        subject NVARCHAR(500),
        primary_domain NVARCHAR(255),
        subdomain NVARCHAR(255),
        email_date DATETIME2,
        action NVARCHAR(20),
        matched_rule NVARCHAR(100),
        matched_pattern NVARCHAR(500),
        created_at DATETIME2 DEFAULT GETDATE(),
        CONSTRAINT UQ_pending_email_user UNIQUE (email_id, user_email)
    );
    PRINT 'Created pending_emails table with user_email column';
END
ELSE
BEGIN
    -- Add user_email column if table exists but column doesn't
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('pending_emails') AND name = 'user_email')
    BEGIN
        ALTER TABLE pending_emails ADD user_email NVARCHAR(255) NOT NULL DEFAULT 'default@user.com';
        PRINT 'Added user_email column to pending_emails table';
    END
    ELSE
    BEGIN
        PRINT 'user_email column already exists in pending_emails table';
    END
END
GO

-- Create index on pending_emails.user_email
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('pending_emails') AND name = 'idx_pending_user_email')
BEGIN
    CREATE INDEX idx_pending_user_email ON pending_emails(user_email);
    PRINT 'Created index on pending_emails.user_email';
END
GO

-- ============================================================================
-- Step 3: Create users table for future user management
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'users')
BEGIN
    CREATE TABLE users (
        id INT IDENTITY PRIMARY KEY,
        email NVARCHAR(255) NOT NULL UNIQUE,
        display_name NVARCHAR(255),
        first_login DATETIME2 DEFAULT GETDATE(),
        last_login DATETIME2 DEFAULT GETDATE(),
        settings NVARCHAR(MAX)  -- JSON for user preferences
    );
    PRINT 'Created users table';
END
GO

-- ============================================================================
-- Step 4: Update EvaluateEmails stored procedure to accept user_email
-- ============================================================================
IF OBJECT_ID('dbo.EvaluateEmailsForUser', 'P') IS NOT NULL
    DROP PROCEDURE dbo.EvaluateEmailsForUser;
GO

CREATE PROCEDURE dbo.EvaluateEmailsForUser
    @Emails dbo.EmailInputType READONLY,
    @UserEmail NVARCHAR(255),
    @MinAgeDays INT = 0,
    @Verbose BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    -- Temp table to hold results
    CREATE TABLE #Results (
        RowId INT,
        EmailId NVARCHAR(100),
        FromEmail NVARCHAR(255),
        ToEmail NVARCHAR(255),
        Subject NVARCHAR(500),
        PrimaryDomain NVARCHAR(255),
        Subdomain NVARCHAR(255),
        EmailDate DATETIME2,
        DomainCriteriaId INT,
        SubdomainCriteriaId INT,
        EmailKeyCriteriaId INT,
        EffectiveCriteriaId INT,
        P1_EmailKeyAction NVARCHAR(20),
        P2_FromEmailKeepMatch NVARCHAR(255),
        P3_FromEmailDeleteMatch NVARCHAR(255),
        P4_ToEmailKeepMatch NVARCHAR(255),
        P5_ToEmailDeleteMatch NVARCHAR(255),
        P6_SubjectKeepMatch NVARCHAR(500),
        P7_SubjectDeleteMatch NVARCHAR(500),
        P8_SubjectDelete1dMatch NVARCHAR(500),
        P9_SubjectDelete10dMatch NVARCHAR(500),
        P10_DefaultAction NVARCHAR(20),
        FinalAction NVARCHAR(20),
        MatchedRule NVARCHAR(100),
        MatchedPattern NVARCHAR(500)
    );

    -- Load emails with age filter
    INSERT INTO #Results (
        RowId, EmailId, FromEmail, ToEmail, Subject,
        PrimaryDomain, Subdomain, EmailDate
    )
    SELECT
        RowId, EmailId, LOWER(FromEmail), LOWER(ToEmail), Subject,
        LOWER(PrimaryDomain), LOWER(Subdomain), EmailDate
    FROM @Emails
    WHERE @MinAgeDays = 0
       OR EmailDate <= DATEADD(DAY, -@MinAgeDays, GETDATE());

    -- A1: Check if FROM email is a top-level key (email type) - filtered by user_email
    UPDATE r
    SET EmailKeyCriteriaId = c.id,
        P1_EmailKeyAction = c.default_action
    FROM #Results r
    INNER JOIN criteria c ON r.FromEmail = c.key_value
                          AND c.key_type = 'email'
                          AND c.user_email = @UserEmail;

    -- A2: Find domain criteria - filtered by user_email
    UPDATE r
    SET DomainCriteriaId = c.id
    FROM #Results r
    INNER JOIN criteria c ON r.PrimaryDomain = c.key_value
                          AND c.key_type = 'domain'
                          AND c.user_email = @UserEmail;

    -- A3: Find subdomain criteria - filtered by user_email
    UPDATE r
    SET SubdomainCriteriaId = c.id
    FROM #Results r
    INNER JOIN criteria c ON r.Subdomain = c.key_value
                          AND c.key_type = 'subdomain'
                          AND c.parent_id = r.DomainCriteriaId
                          AND c.user_email = @UserEmail
    WHERE r.Subdomain IS NOT NULL AND r.Subdomain <> '';

    -- A4: Set effective criteria
    UPDATE #Results
    SET EffectiveCriteriaId = COALESCE(SubdomainCriteriaId, DomainCriteriaId);

    -- B1: fromEmails KEEP
    UPDATE r
    SET P2_FromEmailKeepMatch = ep.email
    FROM #Results r
    INNER JOIN email_patterns ep ON ep.criteria_id = r.EffectiveCriteriaId
                                 AND ep.direction = 'from'
                                 AND ep.action = 'keep'
                                 AND LOWER(ep.email) = r.FromEmail
    WHERE r.P1_EmailKeyAction IS NULL;

    -- B2: fromEmails DELETE
    UPDATE r
    SET P3_FromEmailDeleteMatch = ep.email
    FROM #Results r
    INNER JOIN email_patterns ep ON ep.criteria_id = r.EffectiveCriteriaId
                                 AND ep.direction = 'from'
                                 AND ep.action = 'delete'
                                 AND LOWER(ep.email) = r.FromEmail
    WHERE r.P1_EmailKeyAction IS NULL
      AND r.P2_FromEmailKeepMatch IS NULL;

    -- C1: toEmails KEEP
    UPDATE r
    SET P4_ToEmailKeepMatch = ep.email
    FROM #Results r
    INNER JOIN email_patterns ep ON ep.criteria_id = r.EffectiveCriteriaId
                                 AND ep.direction = 'to'
                                 AND ep.action = 'keep'
                                 AND LOWER(ep.email) = r.ToEmail
    WHERE r.P1_EmailKeyAction IS NULL
      AND r.P2_FromEmailKeepMatch IS NULL
      AND r.P3_FromEmailDeleteMatch IS NULL;

    -- C2: toEmails DELETE
    UPDATE r
    SET P5_ToEmailDeleteMatch = ep.email
    FROM #Results r
    INNER JOIN email_patterns ep ON ep.criteria_id = r.EffectiveCriteriaId
                                 AND ep.direction = 'to'
                                 AND ep.action = 'delete'
                                 AND LOWER(ep.email) = r.ToEmail
    WHERE r.P1_EmailKeyAction IS NULL
      AND r.P2_FromEmailKeepMatch IS NULL
      AND r.P3_FromEmailDeleteMatch IS NULL
      AND r.P4_ToEmailKeepMatch IS NULL;

    -- D1: Subject KEEP patterns
    UPDATE r
    SET P6_SubjectKeepMatch = p.pattern
    FROM #Results r
    CROSS APPLY (
        SELECT TOP 1 pattern
        FROM patterns p
        WHERE p.criteria_id = r.EffectiveCriteriaId
          AND p.action = 'keep'
          AND r.Subject LIKE '%' + p.pattern + '%'
    ) p
    WHERE r.P1_EmailKeyAction IS NULL
      AND r.P2_FromEmailKeepMatch IS NULL
      AND r.P3_FromEmailDeleteMatch IS NULL
      AND r.P4_ToEmailKeepMatch IS NULL
      AND r.P5_ToEmailDeleteMatch IS NULL;

    -- D2: Subject DELETE patterns
    UPDATE r
    SET P7_SubjectDeleteMatch = p.pattern
    FROM #Results r
    CROSS APPLY (
        SELECT TOP 1 pattern
        FROM patterns p
        WHERE p.criteria_id = r.EffectiveCriteriaId
          AND p.action = 'delete'
          AND r.Subject LIKE '%' + p.pattern + '%'
    ) p
    WHERE r.P1_EmailKeyAction IS NULL
      AND r.P2_FromEmailKeepMatch IS NULL
      AND r.P3_FromEmailDeleteMatch IS NULL
      AND r.P4_ToEmailKeepMatch IS NULL
      AND r.P5_ToEmailDeleteMatch IS NULL
      AND r.P6_SubjectKeepMatch IS NULL;

    -- D3: Subject DELETE_1D patterns
    UPDATE r
    SET P8_SubjectDelete1dMatch = p.pattern
    FROM #Results r
    CROSS APPLY (
        SELECT TOP 1 pattern
        FROM patterns p
        WHERE p.criteria_id = r.EffectiveCriteriaId
          AND p.action = 'delete_1d'
          AND r.Subject LIKE '%' + p.pattern + '%'
    ) p
    WHERE r.P1_EmailKeyAction IS NULL
      AND r.P2_FromEmailKeepMatch IS NULL
      AND r.P3_FromEmailDeleteMatch IS NULL
      AND r.P4_ToEmailKeepMatch IS NULL
      AND r.P5_ToEmailDeleteMatch IS NULL
      AND r.P6_SubjectKeepMatch IS NULL
      AND r.P7_SubjectDeleteMatch IS NULL;

    -- D4: Subject DELETE_10D patterns
    UPDATE r
    SET P9_SubjectDelete10dMatch = p.pattern
    FROM #Results r
    CROSS APPLY (
        SELECT TOP 1 pattern
        FROM patterns p
        WHERE p.criteria_id = r.EffectiveCriteriaId
          AND p.action = 'delete_10d'
          AND r.Subject LIKE '%' + p.pattern + '%'
    ) p
    WHERE r.P1_EmailKeyAction IS NULL
      AND r.P2_FromEmailKeepMatch IS NULL
      AND r.P3_FromEmailDeleteMatch IS NULL
      AND r.P4_ToEmailKeepMatch IS NULL
      AND r.P5_ToEmailDeleteMatch IS NULL
      AND r.P6_SubjectKeepMatch IS NULL
      AND r.P7_SubjectDeleteMatch IS NULL
      AND r.P8_SubjectDelete1dMatch IS NULL;

    -- E: Get default action
    UPDATE r
    SET P10_DefaultAction = c.default_action
    FROM #Results r
    INNER JOIN criteria c ON c.id = r.EffectiveCriteriaId
    WHERE r.P1_EmailKeyAction IS NULL
      AND r.P2_FromEmailKeepMatch IS NULL
      AND r.P3_FromEmailDeleteMatch IS NULL
      AND r.P4_ToEmailKeepMatch IS NULL
      AND r.P5_ToEmailDeleteMatch IS NULL
      AND r.P6_SubjectKeepMatch IS NULL
      AND r.P7_SubjectDeleteMatch IS NULL
      AND r.P8_SubjectDelete1dMatch IS NULL
      AND r.P9_SubjectDelete10dMatch IS NULL;

    -- F: Determine final action
    UPDATE #Results
    SET
        FinalAction = CASE
            WHEN P1_EmailKeyAction IS NOT NULL THEN P1_EmailKeyAction
            WHEN P2_FromEmailKeepMatch IS NOT NULL THEN 'keep'
            WHEN P3_FromEmailDeleteMatch IS NOT NULL THEN 'delete'
            WHEN P4_ToEmailKeepMatch IS NOT NULL THEN 'keep'
            WHEN P5_ToEmailDeleteMatch IS NOT NULL THEN 'delete'
            WHEN P6_SubjectKeepMatch IS NOT NULL THEN 'keep'
            WHEN P7_SubjectDeleteMatch IS NOT NULL THEN 'delete'
            WHEN P8_SubjectDelete1dMatch IS NOT NULL THEN 'delete_1d'
            WHEN P9_SubjectDelete10dMatch IS NOT NULL THEN 'delete_10d'
            WHEN P10_DefaultAction IS NOT NULL THEN P10_DefaultAction
            ELSE NULL
        END,
        MatchedRule = CASE
            WHEN P1_EmailKeyAction IS NOT NULL THEN 'email_key.default'
            WHEN P2_FromEmailKeepMatch IS NOT NULL THEN 'fromEmails.keep'
            WHEN P3_FromEmailDeleteMatch IS NOT NULL THEN 'fromEmails.delete'
            WHEN P4_ToEmailKeepMatch IS NOT NULL THEN 'toEmails.keep'
            WHEN P5_ToEmailDeleteMatch IS NOT NULL THEN 'toEmails.delete'
            WHEN P6_SubjectKeepMatch IS NOT NULL THEN 'pattern.keep'
            WHEN P7_SubjectDeleteMatch IS NOT NULL THEN 'pattern.delete'
            WHEN P8_SubjectDelete1dMatch IS NOT NULL THEN 'pattern.delete_1d'
            WHEN P9_SubjectDelete10dMatch IS NOT NULL THEN 'pattern.delete_10d'
            WHEN P10_DefaultAction IS NOT NULL THEN 'default'
            ELSE 'none'
        END,
        MatchedPattern = CASE
            WHEN P1_EmailKeyAction IS NOT NULL THEN FromEmail
            WHEN P2_FromEmailKeepMatch IS NOT NULL THEN P2_FromEmailKeepMatch
            WHEN P3_FromEmailDeleteMatch IS NOT NULL THEN P3_FromEmailDeleteMatch
            WHEN P4_ToEmailKeepMatch IS NOT NULL THEN P4_ToEmailKeepMatch
            WHEN P5_ToEmailDeleteMatch IS NOT NULL THEN P5_ToEmailDeleteMatch
            WHEN P6_SubjectKeepMatch IS NOT NULL THEN P6_SubjectKeepMatch
            WHEN P7_SubjectDeleteMatch IS NOT NULL THEN P7_SubjectDeleteMatch
            WHEN P8_SubjectDelete1dMatch IS NOT NULL THEN P8_SubjectDelete1dMatch
            WHEN P9_SubjectDelete10dMatch IS NOT NULL THEN P9_SubjectDelete10dMatch
            WHEN P10_DefaultAction IS NOT NULL THEN PrimaryDomain
            ELSE NULL
        END;

    -- Return results
    IF @Verbose = 1
    BEGIN
        SELECT
            EmailId,
            FromEmail,
            ToEmail,
            LEFT(Subject, 50) AS Subject,
            PrimaryDomain,
            Subdomain,
            ISNULL(FinalAction, 'undecided') AS Action,
            MatchedRule,
            MatchedPattern,
            CASE WHEN DomainCriteriaId IS NOT NULL THEN 'Yes' ELSE 'No' END AS DomainFound,
            CASE WHEN SubdomainCriteriaId IS NOT NULL THEN 'Yes' ELSE 'No' END AS SubdomainFound,
            CASE WHEN EmailKeyCriteriaId IS NOT NULL THEN 'Yes' ELSE 'No' END AS EmailKeyFound
        FROM #Results
        ORDER BY RowId;
    END
    ELSE
    BEGIN
        SELECT
            EmailId,
            ISNULL(FinalAction, 'undecided') AS Action,
            MatchedRule,
            MatchedPattern
        FROM #Results
        ORDER BY RowId;
    END

    -- Summary statistics
    SELECT
        COUNT(*) AS TotalEmails,
        SUM(CASE WHEN FinalAction = 'delete' THEN 1 ELSE 0 END) AS DeleteCount,
        SUM(CASE WHEN FinalAction = 'delete_1d' THEN 1 ELSE 0 END) AS Delete1dCount,
        SUM(CASE WHEN FinalAction = 'delete_10d' THEN 1 ELSE 0 END) AS Delete10dCount,
        SUM(CASE WHEN FinalAction = 'keep' THEN 1 ELSE 0 END) AS KeepCount,
        SUM(CASE WHEN FinalAction IS NULL THEN 1 ELSE 0 END) AS UndecidedCount
    FROM #Results;

    DROP TABLE #Results;
END;
GO

PRINT 'Created EvaluateEmailsForUser stored procedure';
GO

-- ============================================================================
-- Step 5: Create procedure to migrate existing data to a specific user
-- ============================================================================
IF OBJECT_ID('dbo.MigrateUserData', 'P') IS NOT NULL
    DROP PROCEDURE dbo.MigrateUserData;
GO

CREATE PROCEDURE dbo.MigrateUserData
    @FromUserEmail NVARCHAR(255) = 'default@user.com',
    @ToUserEmail NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    -- Update criteria
    UPDATE criteria
    SET user_email = @ToUserEmail, updated_at = GETDATE()
    WHERE user_email = @FromUserEmail;

    DECLARE @criteriaCount INT = @@ROWCOUNT;

    -- Update pending_emails
    UPDATE pending_emails
    SET user_email = @ToUserEmail
    WHERE user_email = @FromUserEmail;

    DECLARE @emailCount INT = @@ROWCOUNT;

    -- Create or update user record
    IF NOT EXISTS (SELECT 1 FROM users WHERE email = @ToUserEmail)
    BEGIN
        INSERT INTO users (email, first_login, last_login)
        VALUES (@ToUserEmail, GETDATE(), GETDATE());
    END
    ELSE
    BEGIN
        UPDATE users SET last_login = GETDATE() WHERE email = @ToUserEmail;
    END

    SELECT @criteriaCount AS CriteriaMigrated, @emailCount AS EmailsMigrated;
END;
GO

PRINT 'Created MigrateUserData stored procedure';
GO

PRINT '============================================================================';
PRINT 'Multi-user support migration completed successfully!';
PRINT '============================================================================';
GO
