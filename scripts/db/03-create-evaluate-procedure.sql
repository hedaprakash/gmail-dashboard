-- ============================================================================
-- Gmail Criteria: EvaluateEmails Stored Procedure
-- ============================================================================
-- This procedure evaluates a batch of emails against all criteria rules
-- and returns the action (keep, delete, delete_1d, delete_10d, or NULL for undecided).
--
-- Matching Priority (highest to lowest):
--   1. Email address as top-level key (FROM email is a criteria key)
--   2. fromEmails keep rules
--   3. fromEmails delete rules
--   4. toEmails keep rules
--   5. toEmails delete rules
--   6. Subject keep patterns
--   7. Subject delete patterns
--   8. Subject delete_1d patterns
--   9. Subject delete_10d patterns
--  10. Default action (from subdomain or domain)
--  11. No match = NULL (undecided)
--
-- Usage:
--   EXEC dbo.EvaluateEmails @Emails = @myEmails, @Verbose = 1
-- ============================================================================

USE GmailCriteria;
GO

-- ============================================================================
-- Step 1: Create Table Type for Input
-- ============================================================================
IF TYPE_ID('dbo.EmailInputType') IS NOT NULL
    DROP TYPE dbo.EmailInputType;
GO

CREATE TYPE dbo.EmailInputType AS TABLE (
    RowId INT IDENTITY(1,1),          -- For tracking
    EmailId NVARCHAR(100),            -- Gmail message ID or any identifier
    FromEmail NVARCHAR(255),          -- Sender email address
    ToEmail NVARCHAR(255),            -- Recipient email address
    Subject NVARCHAR(500),            -- Email subject
    PrimaryDomain NVARCHAR(255),      -- e.g., 'example.com'
    Subdomain NVARCHAR(255),          -- e.g., 'alerts.example.com' or NULL
    EmailDate DATETIME2               -- For age filtering
);
GO

PRINT 'Created EmailInputType table type';
GO

-- ============================================================================
-- Step 2: Create the Main Stored Procedure
-- ============================================================================
IF OBJECT_ID('dbo.EvaluateEmails', 'P') IS NOT NULL
    DROP PROCEDURE dbo.EvaluateEmails;
GO

CREATE PROCEDURE dbo.EvaluateEmails
    @Emails dbo.EmailInputType READONLY,
    @MinAgeDays INT = 0,              -- Only evaluate emails older than N days
    @Verbose BIT = 0                  -- 1 = include match details in output
AS
BEGIN
    SET NOCOUNT ON;

    -- ========================================================================
    -- Temp table to hold results with all matching details
    -- ========================================================================
    CREATE TABLE #Results (
        RowId INT,
        EmailId NVARCHAR(100),
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
        EffectiveCriteriaId INT,      -- The one we'll use (subdomain or domain)

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
    -- Load emails with age filter
    -- ========================================================================
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

    -- ========================================================================
    -- Step A: Find criteria entries for each email
    -- ========================================================================

    -- A1: Check if FROM email is a top-level key (email type)
    UPDATE r
    SET EmailKeyCriteriaId = c.id,
        P1_EmailKeyAction = c.default_action
    FROM #Results r
    INNER JOIN criteria c ON r.FromEmail = c.key_value AND c.key_type = 'email';

    -- A2: Find domain criteria
    UPDATE r
    SET DomainCriteriaId = c.id
    FROM #Results r
    INNER JOIN criteria c ON r.PrimaryDomain = c.key_value AND c.key_type = 'domain';

    -- A3: Find subdomain criteria (if subdomain exists)
    UPDATE r
    SET SubdomainCriteriaId = c.id
    FROM #Results r
    INNER JOIN criteria c ON r.Subdomain = c.key_value
                          AND c.key_type = 'subdomain'
                          AND c.parent_id = r.DomainCriteriaId
    WHERE r.Subdomain IS NOT NULL AND r.Subdomain <> '';

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
    WHERE r.P1_EmailKeyAction IS NULL;  -- Skip if already matched at P1

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
    -- Step D: Check subject patterns (Priority 6-8)
    -- Uses LIKE with pattern matching (case-insensitive)
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
    -- Return results
    -- ========================================================================
    IF @Verbose = 1
    BEGIN
        -- Verbose output with all matching details
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
            -- Debug columns
            CASE WHEN DomainCriteriaId IS NOT NULL THEN 'Yes' ELSE 'No' END AS DomainFound,
            CASE WHEN SubdomainCriteriaId IS NOT NULL THEN 'Yes' ELSE 'No' END AS SubdomainFound,
            CASE WHEN EmailKeyCriteriaId IS NOT NULL THEN 'Yes' ELSE 'No' END AS EmailKeyFound
        FROM #Results
        ORDER BY RowId;
    END
    ELSE
    BEGIN
        -- Compact output
        SELECT
            EmailId,
            ISNULL(FinalAction, 'undecided') AS Action,
            MatchedRule,
            MatchedPattern
        FROM #Results
        ORDER BY RowId;
    END

    -- ========================================================================
    -- Summary statistics
    -- ========================================================================
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

PRINT 'Created EvaluateEmails stored procedure';
GO
