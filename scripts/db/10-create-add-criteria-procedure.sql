-- ============================================================================
-- Gmail Criteria: AddCriteriaRule Stored Procedure
-- ============================================================================
-- This procedure receives raw email fields from TypeScript and handles ALL
-- business logic for creating criteria entries.
--
-- TypeScript is a "dumb pipe" - it passes raw data, no extraction/computation.
-- This procedure:
--   1. Parses email addresses to extract domain parts
--   2. Determines if subdomain exists
--   3. Creates parent domain entries when needed
--   4. Sets correct key_type and parent_id
--   5. Adds patterns or default actions
--
-- See: docs/adr/ADR-003-add-criteria-rule-workflow.md
-- ============================================================================

USE GmailCriteria;
GO

-- ============================================================================
-- Helper Function: Extract primary domain from full domain
-- e.g., 'custcomm.icicibank.com' -> 'icicibank.com'
-- ============================================================================
IF OBJECT_ID('dbo.GetPrimaryDomain', 'FN') IS NOT NULL
    DROP FUNCTION dbo.GetPrimaryDomain;
GO

CREATE FUNCTION dbo.GetPrimaryDomain(@FullDomain NVARCHAR(255))
RETURNS NVARCHAR(255)
AS
BEGIN
    DECLARE @Result NVARCHAR(255);
    DECLARE @DotCount INT = LEN(@FullDomain) - LEN(REPLACE(@FullDomain, '.', ''));

    IF @DotCount < 2
    BEGIN
        -- No subdomain: icicibank.com -> icicibank.com
        SET @Result = @FullDomain;
    END
    ELSE
    BEGIN
        -- Has subdomain: custcomm.icicibank.com -> icicibank.com
        -- Find the position to start extracting (after first dot from left that leaves 2 parts)
        DECLARE @LastDotPos INT = LEN(@FullDomain) - CHARINDEX('.', REVERSE(@FullDomain)) + 1;
        DECLARE @SearchStart INT = LEN(@FullDomain) - @LastDotPos + 2;
        DECLARE @SecondLastDotPos INT = LEN(@FullDomain) - CHARINDEX('.', REVERSE(@FullDomain), @SearchStart) + 1;

        IF @SecondLastDotPos > 0 AND @SecondLastDotPos < @LastDotPos
            SET @Result = SUBSTRING(@FullDomain, @SecondLastDotPos + 1, LEN(@FullDomain));
        ELSE
            SET @Result = @FullDomain;
    END

    RETURN @Result;
END;
GO

PRINT 'Created GetPrimaryDomain function';
GO

-- ============================================================================
-- Helper Function: Extract domain from email address
-- e.g., 'noreply@custcomm.icicibank.com' -> 'custcomm.icicibank.com'
-- ============================================================================
IF OBJECT_ID('dbo.GetDomainFromEmail', 'FN') IS NOT NULL
    DROP FUNCTION dbo.GetDomainFromEmail;
GO

CREATE FUNCTION dbo.GetDomainFromEmail(@Email NVARCHAR(255))
RETURNS NVARCHAR(255)
AS
BEGIN
    DECLARE @AtPos INT = CHARINDEX('@', @Email);
    IF @AtPos = 0
        RETURN @Email;  -- Not an email, return as-is
    RETURN LOWER(SUBSTRING(@Email, @AtPos + 1, LEN(@Email)));
END;
GO

PRINT 'Created GetDomainFromEmail function';
GO

-- ============================================================================
-- Helper Function: Check if domain has subdomain
-- e.g., 'custcomm.icicibank.com' -> 1, 'icicibank.com' -> 0
-- ============================================================================
IF OBJECT_ID('dbo.HasSubdomain', 'FN') IS NOT NULL
    DROP FUNCTION dbo.HasSubdomain;
GO

CREATE FUNCTION dbo.HasSubdomain(@FullDomain NVARCHAR(255))
RETURNS BIT
AS
BEGIN
    DECLARE @DotCount INT = LEN(@FullDomain) - LEN(REPLACE(@FullDomain, '.', ''));
    IF @DotCount >= 2
        RETURN 1;
    RETURN 0;
END;
GO

PRINT 'Created HasSubdomain function';
GO

-- ============================================================================
-- Main Stored Procedure: AddCriteriaRule
-- ============================================================================
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

    -- Validate @UserEmail FIRST (multi-user security)
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
                SET @Message = @Message + '; Added pattern: ' + @SubjectPattern;
            END
            ELSE
            BEGIN
                SET @Message = @Message + '; Pattern already exists: ' + @SubjectPattern;
            END
        END
        ELSE
        BEGIN
            -- Set default action
            UPDATE criteria SET default_action = @Action
            WHERE id = @CriteriaId;
            SET @Message = @Message + '; Set default action: ' + @Action;
        END
    END

    ELSE IF @Level = 'subdomain'
    BEGIN
        -- ====================================================================
        -- SUBDOMAIN LEVEL: Rule applies only to specific subdomain
        -- ====================================================================

        -- Edge case: If email has no subdomain (e.g., info@simple.com),
        -- treat it as domain level to avoid duplicate key errors
        IF @HasSub = 0
        BEGIN
            -- No actual subdomain - fall back to domain level
            SELECT @CriteriaId = id FROM criteria
            WHERE key_value = @PrimaryDomain
              AND key_type = 'domain'
              AND user_email = @UserEmail;

            IF @CriteriaId IS NULL
            BEGIN
                INSERT INTO criteria (key_value, key_type, parent_id, user_email)
                VALUES (@PrimaryDomain, 'domain', NULL, @UserEmail);
                SET @CriteriaId = SCOPE_IDENTITY();
                SET @Message = 'Created domain (no subdomain in email): ' + @PrimaryDomain;
            END
            ELSE
            BEGIN
                SET @Message = 'Found domain (no subdomain in email): ' + @PrimaryDomain;
            END
        END
        ELSE
        BEGIN
            -- Normal case: Has subdomain

            -- STEP 1: Ensure parent domain entry exists
            SELECT @ParentId = id FROM criteria
            WHERE key_value = @PrimaryDomain
              AND key_type = 'domain'
              AND user_email = @UserEmail;

            IF @ParentId IS NULL
            BEGIN
                INSERT INTO criteria (key_value, key_type, parent_id, user_email)
                VALUES (@PrimaryDomain, 'domain', NULL, @UserEmail);
                SET @ParentId = SCOPE_IDENTITY();
                SET @Message = 'Created parent domain: ' + @PrimaryDomain;
            END
            ELSE
            BEGIN
                SET @Message = 'Found parent domain: ' + @PrimaryDomain;
            END

            -- STEP 2: Find or create subdomain entry WITH parent link
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
                SET @Message = @Message + '; Created subdomain: ' + @FullDomain;
            END
            ELSE
            BEGIN
                SET @Message = @Message + '; Found subdomain: ' + @FullDomain;
            END
        END

        -- STEP 3: Handle pattern or default action
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
                SET @Message = @Message + '; Added pattern: ' + @SubjectPattern;
            END
            ELSE
            BEGIN
                SET @Message = @Message + '; Pattern already exists: ' + @SubjectPattern;
            END
        END
        ELSE
        BEGIN
            -- Set default action
            UPDATE criteria SET default_action = @Action
            WHERE id = @CriteriaId;
            SET @Message = @Message + '; Set default action: ' + @Action;
        END
    END

    ELSE IF @Level = 'from_email'
    BEGIN
        -- ====================================================================
        -- FROM EMAIL LEVEL: Rule applies to exact sender email
        -- ====================================================================

        DECLARE @FromEmailLower NVARCHAR(255) = LOWER(@FromEmail);

        -- Find or create email criteria
        SELECT @CriteriaId = id FROM criteria
        WHERE key_value = @FromEmailLower
          AND key_type = 'email'
          AND user_email = @UserEmail;

        IF @CriteriaId IS NULL
        BEGIN
            INSERT INTO criteria (key_value, key_type, parent_id, user_email)
            VALUES (@FromEmailLower, 'email', NULL, @UserEmail);
            SET @CriteriaId = SCOPE_IDENTITY();
            SET @Message = 'Created email entry: ' + @FromEmailLower;
        END
        ELSE
        BEGIN
            SET @Message = 'Found existing email entry: ' + @FromEmailLower;
        END

        -- Set default action (from_email doesn't support patterns in this design)
        UPDATE criteria SET default_action = @Action
        WHERE id = @CriteriaId;
        SET @Message = @Message + '; Set default action: ' + @Action;
    END

    ELSE IF @Level = 'to_email'
    BEGIN
        -- ====================================================================
        -- TO EMAIL LEVEL: Rule applies based on recipient
        -- ====================================================================

        DECLARE @ToEmailLower NVARCHAR(255) = LOWER(@ToEmail);
        DECLARE @ToDomain NVARCHAR(255) = dbo.GetDomainFromEmail(@ToEmail);

        -- Find or create domain criteria for organization
        SELECT @CriteriaId = id FROM criteria
        WHERE key_value = @ToDomain
          AND key_type = 'domain'
          AND user_email = @UserEmail;

        IF @CriteriaId IS NULL
        BEGIN
            INSERT INTO criteria (key_value, key_type, parent_id, user_email)
            VALUES (@ToDomain, 'domain', NULL, @UserEmail);
            SET @CriteriaId = SCOPE_IDENTITY();
            SET @Message = 'Created domain for to_email: ' + @ToDomain;
        END
        ELSE
        BEGIN
            SET @Message = 'Found domain for to_email: ' + @ToDomain;
        END

        -- Add to email_patterns table
        IF NOT EXISTS (
            SELECT 1 FROM email_patterns
            WHERE criteria_id = @CriteriaId
              AND LOWER(email) = @ToEmailLower
              AND direction = 'to'
        )
        BEGIN
            INSERT INTO email_patterns (criteria_id, email, direction, action)
            VALUES (@CriteriaId, @ToEmailLower, 'to', @Action);
            SET @Message = @Message + '; Added to_email pattern: ' + @ToEmailLower;
        END
        ELSE
        BEGIN
            -- Update existing
            UPDATE email_patterns SET action = @Action
            WHERE criteria_id = @CriteriaId
              AND LOWER(email) = @ToEmailLower
              AND direction = 'to';
            SET @Message = @Message + '; Updated to_email pattern: ' + @ToEmailLower;
        END
    END

    -- Return success
    SELECT
        1 AS Success,
        @Message AS Message,
        @CriteriaId AS CriteriaId,
        @Level AS Level,
        @Action AS Action;

    RETURN 0;
END;
GO

PRINT 'Created AddCriteriaRule stored procedure';
GO

PRINT '============================================================================';
PRINT 'AddCriteriaRule stored procedure created successfully!';
PRINT 'See: docs/adr/ADR-003-add-criteria-rule-workflow.md for usage details';
PRINT '============================================================================';
GO
