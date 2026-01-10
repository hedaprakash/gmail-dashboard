-- Testing Scenarios Stored Procedures
-- Creates procedures for the Testing page functionality

USE GmailCriteria;
GO

-- ============================================================================
-- Constants
-- ============================================================================
-- Test user email for isolation from production data
-- This user will never exist in real OAuth flow
DECLARE @TestUserEmail NVARCHAR(255) = 'test-scenarios@test.local';
GO

-- ============================================================================
-- Procedure: GetTestSqlCounts
-- Purpose: Get row counts for test user's data across all tables
-- ============================================================================
IF OBJECT_ID('dbo.GetTestSqlCounts', 'P') IS NOT NULL
    DROP PROCEDURE dbo.GetTestSqlCounts;
GO

CREATE PROCEDURE dbo.GetTestSqlCounts
    @UserEmail NVARCHAR(255) = 'test-scenarios@test.local'
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        (SELECT COUNT(*) FROM criteria WHERE user_email = @UserEmail) AS criteria_count,
        (SELECT COUNT(*) FROM patterns p
         INNER JOIN criteria c ON p.criteria_id = c.id
         WHERE c.user_email = @UserEmail) AS patterns_count,
        (SELECT COUNT(*) FROM email_patterns ep
         INNER JOIN criteria c ON ep.criteria_id = c.id
         WHERE c.user_email = @UserEmail) AS email_patterns_count,
        (SELECT COUNT(*) FROM audit_log WHERE user_email = @UserEmail) AS audit_log_count;
END;
GO

-- ============================================================================
-- Procedure: ClearTestScenarioData
-- Purpose: Clear all test data for the test user
-- Returns: Count of deleted rows per table
-- ============================================================================
IF OBJECT_ID('dbo.ClearTestScenarioData', 'P') IS NOT NULL
    DROP PROCEDURE dbo.ClearTestScenarioData;
GO

CREATE PROCEDURE dbo.ClearTestScenarioData
    @UserEmail NVARCHAR(255) = 'test-scenarios@test.local'
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @CriteriaDeleted INT = 0;
    DECLARE @PatternsDeleted INT = 0;
    DECLARE @EmailPatternsDeleted INT = 0;
    DECLARE @AuditLogDeleted INT = 0;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- Delete patterns first (FK constraint)
        DELETE FROM patterns
        WHERE criteria_id IN (SELECT id FROM criteria WHERE user_email = @UserEmail);
        SET @PatternsDeleted = @@ROWCOUNT;

        -- Delete email_patterns (FK constraint)
        DELETE FROM email_patterns
        WHERE criteria_id IN (SELECT id FROM criteria WHERE user_email = @UserEmail);
        SET @EmailPatternsDeleted = @@ROWCOUNT;

        -- Delete criteria
        DELETE FROM criteria WHERE user_email = @UserEmail;
        SET @CriteriaDeleted = @@ROWCOUNT;

        -- Delete audit_log entries
        DELETE FROM audit_log WHERE user_email = @UserEmail;
        SET @AuditLogDeleted = @@ROWCOUNT;

        COMMIT TRANSACTION;

        SELECT
            1 AS success,
            'Test data cleared successfully' AS message,
            @CriteriaDeleted AS criteria_deleted,
            @PatternsDeleted AS patterns_deleted,
            @EmailPatternsDeleted AS email_patterns_deleted,
            @AuditLogDeleted AS audit_log_deleted;

    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

        SELECT
            0 AS success,
            ERROR_MESSAGE() AS message,
            0 AS criteria_deleted,
            0 AS patterns_deleted,
            0 AS email_patterns_deleted,
            0 AS audit_log_deleted;
    END CATCH;
END;
GO

-- ============================================================================
-- Procedure: GetTestScenarioResults
-- Purpose: Get current state of test user's criteria for verification
-- ============================================================================
IF OBJECT_ID('dbo.GetTestScenarioResults', 'P') IS NOT NULL
    DROP PROCEDURE dbo.GetTestScenarioResults;
GO

CREATE PROCEDURE dbo.GetTestScenarioResults
    @UserEmail NVARCHAR(255) = 'test-scenarios@test.local'
AS
BEGIN
    SET NOCOUNT ON;

    -- Get all criteria entries for test user
    SELECT
        c.id,
        c.key_type,
        c.key_value,
        c.default_action,
        c.parent_id,
        c.created_at,
        c.updated_at
    FROM criteria c
    WHERE c.user_email = @UserEmail
    ORDER BY c.key_type, c.key_value;

    -- Get all patterns for test user
    SELECT
        p.id,
        p.criteria_id,
        c.key_value AS domain,
        p.pattern,
        p.action,
        p.created_at
    FROM patterns p
    INNER JOIN criteria c ON p.criteria_id = c.id
    WHERE c.user_email = @UserEmail
    ORDER BY c.key_value, p.action, p.pattern;

    -- Get all email patterns for test user
    SELECT
        ep.id,
        ep.criteria_id,
        c.key_value AS domain,
        ep.pattern_type,
        ep.email,
        ep.action,
        ep.created_at
    FROM email_patterns ep
    INNER JOIN criteria c ON ep.criteria_id = c.id
    WHERE c.user_email = @UserEmail
    ORDER BY c.key_value, ep.pattern_type, ep.action;
END;
GO

-- ============================================================================
-- Grant permissions
-- ============================================================================
GRANT EXECUTE ON dbo.GetTestSqlCounts TO PUBLIC;
GRANT EXECUTE ON dbo.ClearTestScenarioData TO PUBLIC;
GRANT EXECUTE ON dbo.GetTestScenarioResults TO PUBLIC;
GO

PRINT 'Testing procedures created successfully.';
GO
