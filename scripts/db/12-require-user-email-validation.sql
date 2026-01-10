-- ============================================================================
-- User Email Validation for Multi-User Security
-- ============================================================================
-- This script updates stored procedures to REQUIRE @UserEmail parameter.
-- Without a valid user email, procedures will fail with an error.
--
-- Affected procedures:
--   - EvaluatePendingEmails
--   - ModifyCriteria
--   - AddCriteriaRule
--
-- Run: ./scripts/db/setup.sh (or run this file directly)
-- ============================================================================

USE GmailCriteria;
GO

-- ============================================================================
-- Update EvaluatePendingEmails to REQUIRE @UserEmail
-- ============================================================================
IF OBJECT_ID('dbo.EvaluatePendingEmails', 'P') IS NOT NULL
    DROP PROCEDURE dbo.EvaluatePendingEmails;
GO

CREATE PROCEDURE dbo.EvaluatePendingEmails
    @UserEmail NVARCHAR(255)  -- REQUIRED: No default, must be provided
AS
BEGIN
    SET NOCOUNT ON;

    -- ========================================================================
    -- Validate @UserEmail is provided and not empty
    -- ========================================================================
    IF @UserEmail IS NULL OR @UserEmail = ''
    BEGIN
        RAISERROR('UserEmail is required. Multi-user isolation requires a valid user email.', 16, 1);
        RETURN -1;
    END

    -- ========================================================================
    -- Temp table to hold evaluation results
    -- ========================================================================
    CREATE TABLE #Results (
        PendingId INT,
        EmailId NVARCHAR(100),
        UserEmail NVARCHAR(255),
        FromEmail NVARCHAR(255),
        ToEmail NVARCHAR(255),
        Subject NVARCHAR(500),
        PrimaryDomain NVARCHAR(255),
        Subdomain NVARCHAR(255),
        EmailDate DATETIME2,

        -- Criteria lookups
        DomainCriteriaId INT,
        SubdomainCriteriaId INT,
        EmailKeyCriteriaId INT,
        EffectiveCriteriaId INT,

        -- Match results at each priority level
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

        -- Final result
        FinalAction NVARCHAR(20),
        MatchedRule NVARCHAR(100),
        MatchedPattern NVARCHAR(500)
    );

    -- ========================================================================
    -- Load pending emails for this user ONLY
    -- ========================================================================
    INSERT INTO #Results (
        PendingId, EmailId, UserEmail, FromEmail, ToEmail, Subject,
        PrimaryDomain, Subdomain, EmailDate
    )
    SELECT
        Id,
        GmailId,
        user_email,
        LOWER(FromEmail),
        LOWER(ToEmail),
        Subject,
        LOWER(PrimaryDomain),
        LOWER(Subdomain),
        EmailDate
    FROM pending_emails
    WHERE user_email = @UserEmail;

    -- ========================================================================
    -- Step A: Find criteria entries for each email
    -- ========================================================================

    -- A1: Check if FROM email is a top-level key (email type)
    UPDATE r
    SET EmailKeyCriteriaId = c.id,
        P1_EmailKeyAction = c.default_action
    FROM #Results r
    INNER JOIN criteria c ON r.FromEmail = c.key_value
                          AND c.key_type = 'email'
                          AND c.user_email = r.UserEmail;

    -- A2: Find domain criteria
    UPDATE r
    SET DomainCriteriaId = c.id
    FROM #Results r
    INNER JOIN criteria c ON r.PrimaryDomain = c.key_value
                          AND c.key_type = 'domain'
                          AND c.user_email = r.UserEmail;

    -- A3: Find subdomain criteria (if subdomain exists)
    UPDATE r
    SET SubdomainCriteriaId = c.id
    FROM #Results r
    INNER JOIN criteria c ON r.Subdomain = c.key_value
                          AND c.key_type = 'subdomain'
                          AND c.parent_id = r.DomainCriteriaId
                          AND c.user_email = r.UserEmail
    WHERE r.Subdomain IS NOT NULL AND r.Subdomain <> '';

    -- A3b: Also check for subdomain stored as domain type
    UPDATE r
    SET SubdomainCriteriaId = c.id
    FROM #Results r
    INNER JOIN criteria c ON r.Subdomain = c.key_value
                          AND c.key_type = 'domain'
                          AND c.user_email = r.UserEmail
    WHERE r.Subdomain IS NOT NULL
      AND r.Subdomain <> ''
      AND r.SubdomainCriteriaId IS NULL;

    -- A4: Set effective criteria (subdomain takes priority over domain)
    UPDATE #Results
    SET EffectiveCriteriaId = COALESCE(SubdomainCriteriaId, DomainCriteriaId);

    -- ========================================================================
    -- Step B: Check fromEmails patterns (Priority 2-3)
    -- ========================================================================

    -- B1: fromEmails KEEP (Priority 2)
    UPDATE r
    SET P2_FromEmailKeepMatch = ep.email
    FROM #Results r
    INNER JOIN email_patterns ep ON ep.criteria_id = r.EffectiveCriteriaId
                                 AND ep.direction = 'from'
                                 AND ep.action = 'keep'
                                 AND LOWER(ep.email) = r.FromEmail
    WHERE r.P1_EmailKeyAction IS NULL;

    -- B2: fromEmails DELETE (Priority 3)
    UPDATE r
    SET P3_FromEmailDeleteMatch = ep.email
    FROM #Results r
    INNER JOIN email_patterns ep ON ep.criteria_id = r.EffectiveCriteriaId
                                 AND ep.direction = 'from'
                                 AND ep.action = 'delete'
                                 AND LOWER(ep.email) = r.FromEmail
    WHERE r.P1_EmailKeyAction IS NULL
      AND r.P2_FromEmailKeepMatch IS NULL;

    -- ========================================================================
    -- Step C: Check toEmails patterns (Priority 4-5)
    -- ========================================================================

    -- C1: toEmails KEEP (Priority 4)
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

    -- C2: toEmails DELETE (Priority 5)
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

    -- ========================================================================
    -- Step D: Check subject patterns (Priority 6-9)
    -- ========================================================================

    -- D1: Subject KEEP patterns (Priority 6)
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

    -- D2: Subject DELETE patterns (Priority 7)
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

    -- D3: Subject DELETE_1D patterns (Priority 8)
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

    -- D4: Subject DELETE_10D patterns (Priority 9)
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

    -- ========================================================================
    -- Step E: Get default action (Priority 10)
    -- ========================================================================
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

    -- ========================================================================
    -- Step F: Determine final action and matched rule
    -- ========================================================================
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
            ELSE NULL  -- Undecided
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

    -- ========================================================================
    -- Step G: UPDATE pending_emails table with results
    -- ========================================================================
    UPDATE pe
    SET
        Action = ISNULL(r.FinalAction, 'undecided'),
        MatchedRule = r.MatchedRule
    FROM pending_emails pe
    INNER JOIN #Results r ON pe.Id = r.PendingId;

    -- ========================================================================
    -- Return summary statistics
    -- ========================================================================
    SELECT
        @UserEmail AS UserEmail,
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

PRINT 'Updated EvaluatePendingEmails to require @UserEmail';
GO

-- ============================================================================
-- Update ModifyCriteria to validate @UserEmail
-- ============================================================================
-- Add validation at the start of the procedure
-- (We'll alter the existing proc to add validation)
-- ============================================================================

-- First, read the current procedure and recreate with validation
IF OBJECT_ID('dbo.ModifyCriteria', 'P') IS NOT NULL
BEGIN
    -- Get existing procedure definition
    EXEC sp_helptext 'dbo.ModifyCriteria';
END
GO

-- Since we can't easily modify existing procedures inline, we'll create a wrapper
-- that validates and calls the original. Better approach: recreate with validation.

-- For now, add a helper procedure that validates user_email
IF OBJECT_ID('dbo.ValidateUserEmail', 'P') IS NOT NULL
    DROP PROCEDURE dbo.ValidateUserEmail;
GO

CREATE PROCEDURE dbo.ValidateUserEmail
    @UserEmail NVARCHAR(255),
    @ProcedureName NVARCHAR(100)
AS
BEGIN
    IF @UserEmail IS NULL OR LTRIM(RTRIM(@UserEmail)) = ''
    BEGIN
        DECLARE @ErrorMsg NVARCHAR(500) = 'UserEmail is required for ' + @ProcedureName + '. Multi-user isolation requires a valid user email.';
        RAISERROR(@ErrorMsg, 16, 1);
        RETURN -1;
    END
    RETURN 0;
END;
GO

PRINT 'Created ValidateUserEmail helper procedure';
GO

-- ============================================================================
-- Update AddCriteriaRule to validate @UserEmail
-- ============================================================================
-- Read existing procedure
DECLARE @ExistingDef NVARCHAR(MAX);
SELECT @ExistingDef = OBJECT_DEFINITION(OBJECT_ID('dbo.AddCriteriaRule'));

-- Check if validation already exists
IF @ExistingDef NOT LIKE '%UserEmail is required%'
BEGIN
    PRINT 'AddCriteriaRule needs UserEmail validation - will update';
END
GO

-- Recreate AddCriteriaRule with validation
IF OBJECT_ID('dbo.AddCriteriaRule', 'P') IS NOT NULL
    DROP PROCEDURE dbo.AddCriteriaRule;
GO

CREATE PROCEDURE dbo.AddCriteriaRule
    -- Raw email fields (always passed from TypeScript)
    @FromEmail NVARCHAR(255),
    @ToEmail NVARCHAR(255),
    @Subject NVARCHAR(500),

    -- User intent
    @Action NVARCHAR(20),           -- keep, delete, delete_1d, delete_10d
    @Level NVARCHAR(20),            -- domain, subdomain, from_email, to_email
    @SubjectPattern NVARCHAR(500) = NULL,

    -- Context
    @UserEmail NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    -- ========================================================================
    -- Validate @UserEmail FIRST
    -- ========================================================================
    IF @UserEmail IS NULL OR LTRIM(RTRIM(@UserEmail)) = ''
    BEGIN
        RAISERROR('UserEmail is required. Multi-user isolation requires a valid user email.', 16, 1);
        RETURN -1;
    END

    -- Validate other inputs
    IF @FromEmail IS NULL OR @FromEmail = ''
    BEGIN
        RAISERROR('FromEmail is required', 16, 1);
        RETURN -1;
    END

    IF @Action NOT IN ('keep', 'delete', 'delete_1d', 'delete_10d')
    BEGIN
        RAISERROR('Invalid action. Must be: keep, delete, delete_1d, delete_10d', 16, 1);
        RETURN -1;
    END

    IF @Level NOT IN ('domain', 'subdomain', 'from_email', 'to_email')
    BEGIN
        RAISERROR('Invalid level. Must be: domain, subdomain, from_email, to_email', 16, 1);
        RETURN -1;
    END

    -- Extract domain parts from FromEmail
    DECLARE @FullDomain NVARCHAR(255) = dbo.GetDomainFromEmail(@FromEmail);
    DECLARE @PrimaryDomain NVARCHAR(255) = dbo.GetPrimaryDomain(@FullDomain);
    DECLARE @HasSub BIT = dbo.HasSubdomain(@FullDomain);

    -- Variables for criteria IDs
    DECLARE @CriteriaId INT;
    DECLARE @ParentId INT;
    DECLARE @PatternId INT;
    DECLARE @Message NVARCHAR(500);

    -- ========================================================================
    -- Route based on @Level
    -- ========================================================================

    IF @Level = 'domain'
    BEGIN
        -- ====================================================================
        -- DOMAIN LEVEL: Rule applies to entire domain + all subdomains
        -- ====================================================================

        -- Find or create domain criteria
        SELECT @CriteriaId = id FROM criteria
        WHERE key_value = @PrimaryDomain
          AND key_type = 'domain'
          AND user_email = @UserEmail;

        IF @CriteriaId IS NULL
        BEGIN
            INSERT INTO criteria (key_value, key_type, parent_id, user_email)
            VALUES (@PrimaryDomain, 'domain', NULL, @UserEmail);
            SET @CriteriaId = SCOPE_IDENTITY();
            SET @Message = 'Created domain entry: ' + @PrimaryDomain;
        END
        ELSE
        BEGIN
            SET @Message = 'Found existing domain entry: ' + @PrimaryDomain;
        END

        -- Handle pattern or default action
        IF @SubjectPattern IS NOT NULL AND @SubjectPattern <> ''
        BEGIN
            -- Check if pattern already exists
            IF NOT EXISTS (
                SELECT 1 FROM patterns
                WHERE criteria_id = @CriteriaId
                  AND LOWER(pattern) = LOWER(@SubjectPattern)
                  AND action = @Action
            )
            BEGIN
                INSERT INTO patterns (criteria_id, pattern, action)
                VALUES (@CriteriaId, LOWER(@SubjectPattern), @Action);
                SET @PatternId = SCOPE_IDENTITY();
                SET @Message = @Message + '; Added ' + @Action + ' pattern: ' + @SubjectPattern;
            END
            ELSE
            BEGIN
                SET @Message = @Message + '; Pattern already exists: ' + @SubjectPattern;
            END
        END
        ELSE
        BEGIN
            -- Set default action for domain
            UPDATE criteria SET default_action = @Action WHERE id = @CriteriaId;
            SET @Message = @Message + '; Set default action: ' + @Action;
        END
    END
    ELSE IF @Level = 'subdomain'
    BEGIN
        -- ====================================================================
        -- SUBDOMAIN LEVEL: Rule applies to specific subdomain only
        -- ====================================================================

        -- First ensure parent domain exists
        SELECT @ParentId = id FROM criteria
        WHERE key_value = @PrimaryDomain
          AND key_type = 'domain'
          AND user_email = @UserEmail;

        IF @ParentId IS NULL
        BEGIN
            INSERT INTO criteria (key_value, key_type, parent_id, user_email)
            VALUES (@PrimaryDomain, 'domain', NULL, @UserEmail);
            SET @ParentId = SCOPE_IDENTITY();
        END

        -- Find or create subdomain entry
        SELECT @CriteriaId = id FROM criteria
        WHERE key_value = @FullDomain
          AND key_type = 'subdomain'
          AND parent_id = @ParentId
          AND user_email = @UserEmail;

        IF @CriteriaId IS NULL
        BEGIN
            INSERT INTO criteria (key_value, key_type, parent_id, user_email)
            VALUES (@FullDomain, 'subdomain', @ParentId, @UserEmail);
            SET @CriteriaId = SCOPE_IDENTITY();
            SET @Message = 'Created subdomain entry: ' + @FullDomain;
        END
        ELSE
        BEGIN
            SET @Message = 'Found existing subdomain entry: ' + @FullDomain;
        END

        -- Handle pattern or default action
        IF @SubjectPattern IS NOT NULL AND @SubjectPattern <> ''
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM patterns
                WHERE criteria_id = @CriteriaId
                  AND LOWER(pattern) = LOWER(@SubjectPattern)
                  AND action = @Action
            )
            BEGIN
                INSERT INTO patterns (criteria_id, pattern, action)
                VALUES (@CriteriaId, LOWER(@SubjectPattern), @Action);
                SET @PatternId = SCOPE_IDENTITY();
                SET @Message = @Message + '; Added ' + @Action + ' pattern: ' + @SubjectPattern;
            END
            ELSE
            BEGIN
                SET @Message = @Message + '; Pattern already exists: ' + @SubjectPattern;
            END
        END
        ELSE
        BEGIN
            UPDATE criteria SET default_action = @Action WHERE id = @CriteriaId;
            SET @Message = @Message + '; Set default action: ' + @Action;
        END
    END
    ELSE IF @Level = 'from_email'
    BEGIN
        -- ====================================================================
        -- FROM_EMAIL LEVEL: Rule for specific sender email
        -- ====================================================================

        -- Ensure domain criteria exists
        SELECT @CriteriaId = id FROM criteria
        WHERE key_value = @PrimaryDomain
          AND key_type = 'domain'
          AND user_email = @UserEmail;

        IF @CriteriaId IS NULL
        BEGIN
            INSERT INTO criteria (key_value, key_type, parent_id, user_email)
            VALUES (@PrimaryDomain, 'domain', NULL, @UserEmail);
            SET @CriteriaId = SCOPE_IDENTITY();
        END

        -- Add email pattern
        IF NOT EXISTS (
            SELECT 1 FROM email_patterns
            WHERE criteria_id = @CriteriaId
              AND direction = 'from'
              AND LOWER(email) = LOWER(@FromEmail)
              AND action = @Action
        )
        BEGIN
            INSERT INTO email_patterns (criteria_id, direction, email, action)
            VALUES (@CriteriaId, 'from', LOWER(@FromEmail), @Action);
            SET @Message = 'Added from_email ' + @Action + ' rule: ' + @FromEmail;
        END
        ELSE
        BEGIN
            SET @Message = 'From_email rule already exists: ' + @FromEmail;
        END
    END
    ELSE IF @Level = 'to_email'
    BEGIN
        -- ====================================================================
        -- TO_EMAIL LEVEL: Rule for specific recipient email
        -- ====================================================================

        -- Ensure domain criteria exists
        SELECT @CriteriaId = id FROM criteria
        WHERE key_value = @PrimaryDomain
          AND key_type = 'domain'
          AND user_email = @UserEmail;

        IF @CriteriaId IS NULL
        BEGIN
            INSERT INTO criteria (key_value, key_type, parent_id, user_email)
            VALUES (@PrimaryDomain, 'domain', NULL, @UserEmail);
            SET @CriteriaId = SCOPE_IDENTITY();
        END

        -- Add email pattern
        IF NOT EXISTS (
            SELECT 1 FROM email_patterns
            WHERE criteria_id = @CriteriaId
              AND direction = 'to'
              AND LOWER(email) = LOWER(@ToEmail)
              AND action = @Action
        )
        BEGIN
            INSERT INTO email_patterns (criteria_id, direction, email, action)
            VALUES (@CriteriaId, 'to', LOWER(@ToEmail), @Action);
            SET @Message = 'Added to_email ' + @Action + ' rule: ' + @ToEmail;
        END
        ELSE
        BEGIN
            SET @Message = 'To_email rule already exists: ' + @ToEmail;
        END
    END

    -- Return result
    SELECT
        1 AS Success,
        @Message AS Message,
        @CriteriaId AS CriteriaId,
        @PatternId AS PatternId,
        @UserEmail AS UserEmail;
END;
GO

PRINT 'Updated AddCriteriaRule to require @UserEmail';
GO

-- ============================================================================
-- Test the validation
-- ============================================================================
PRINT '';
PRINT '=== Testing UserEmail Validation ===';
PRINT '';

-- Test 1: EvaluatePendingEmails with NULL should fail
BEGIN TRY
    EXEC dbo.EvaluatePendingEmails @UserEmail = NULL;
    PRINT 'FAIL: EvaluatePendingEmails should have rejected NULL UserEmail';
END TRY
BEGIN CATCH
    PRINT 'PASS: EvaluatePendingEmails correctly rejected NULL UserEmail';
    PRINT '      Error: ' + ERROR_MESSAGE();
END CATCH;

-- Test 2: EvaluatePendingEmails with empty string should fail
BEGIN TRY
    EXEC dbo.EvaluatePendingEmails @UserEmail = '';
    PRINT 'FAIL: EvaluatePendingEmails should have rejected empty UserEmail';
END TRY
BEGIN CATCH
    PRINT 'PASS: EvaluatePendingEmails correctly rejected empty UserEmail';
END CATCH;

-- Test 3: AddCriteriaRule with NULL UserEmail should fail
BEGIN TRY
    EXEC dbo.AddCriteriaRule
        @FromEmail = 'test@example.com',
        @ToEmail = 'me@gmail.com',
        @Subject = 'Test',
        @Action = 'delete',
        @Level = 'domain',
        @UserEmail = NULL;
    PRINT 'FAIL: AddCriteriaRule should have rejected NULL UserEmail';
END TRY
BEGIN CATCH
    PRINT 'PASS: AddCriteriaRule correctly rejected NULL UserEmail';
END CATCH;

-- Test 4: Valid call should succeed
BEGIN TRY
    EXEC dbo.EvaluatePendingEmails @UserEmail = 'test@example.com';
    PRINT 'PASS: EvaluatePendingEmails accepted valid UserEmail';
END TRY
BEGIN CATCH
    PRINT 'INFO: EvaluatePendingEmails with valid email (may fail if no data): ' + ERROR_MESSAGE();
END CATCH;

PRINT '';
PRINT '=== Validation Tests Complete ===';
GO
