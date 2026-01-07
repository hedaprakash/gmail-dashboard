-- ============================================================================
-- Gmail Criteria: EvaluatePendingEmails Stored Procedure
-- ============================================================================
-- This procedure reads from the pending_emails table and evaluates each email
-- against criteria rules, then UPDATES the action, matched_rule, and
-- matched_pattern columns directly in the table.
--
-- This is the procedure called by:
--   - POST /api/emails/refresh (after inserting new emails)
--   - POST /api/execute/evaluate (re-evaluate button)
--
-- Usage:
--   EXEC dbo.EvaluatePendingEmails;                    -- All users
--   EXEC dbo.EvaluatePendingEmails @UserEmail = 'user@example.com';  -- Single user
-- ============================================================================

USE GmailCriteria;
GO

IF OBJECT_ID('dbo.EvaluatePendingEmails', 'P') IS NOT NULL
    DROP PROCEDURE dbo.EvaluatePendingEmails;
GO

CREATE PROCEDURE dbo.EvaluatePendingEmails
    @UserEmail NVARCHAR(255) = NULL  -- NULL = evaluate all users
AS
BEGIN
    SET NOCOUNT ON;

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
    -- Load pending emails (optionally filtered by user)
    -- NOTE: Table uses PascalCase column names (GmailId, FromEmail, etc.)
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
    WHERE (@UserEmail IS NULL OR user_email = @UserEmail);

    -- ========================================================================
    -- Step A: Find criteria entries for each email
    -- ========================================================================

    -- A1: Check if FROM email is a top-level key (email type)
    -- Filter by user_email to support multi-user criteria
    UPDATE r
    SET EmailKeyCriteriaId = c.id,
        P1_EmailKeyAction = c.default_action
    FROM #Results r
    INNER JOIN criteria c ON r.FromEmail = c.key_value
                          AND c.key_type = 'email'
                          AND c.user_email = r.UserEmail;

    -- A2: Find domain criteria (filtered by user)
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
    -- NOTE: Table uses PascalCase columns (Action, MatchedRule)
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

PRINT 'Created EvaluatePendingEmails stored procedure';
GO
