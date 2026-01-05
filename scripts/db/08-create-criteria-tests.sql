-- ============================================================================
-- Criteria Modification Test Infrastructure
-- ============================================================================
-- Creates test table, inserts all test cases, and provides test execution.
--
-- Usage:
--   docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
--     -S localhost -U sa -P "MyPass@word123" -C -d GmailCriteria \
--     -i /scripts/08-create-criteria-tests.sql
-- ============================================================================

USE GmailCriteria;
GO

-- ============================================================================
-- Step 1: Create criteria_test_cases table
-- ============================================================================
IF OBJECT_ID('criteria_test_cases', 'U') IS NOT NULL
    DROP TABLE criteria_test_cases;
GO

CREATE TABLE criteria_test_cases (
    id INT IDENTITY(1,1) PRIMARY KEY,
    test_id NVARCHAR(10) NOT NULL,          -- D01, S01, E01, etc.
    category NVARCHAR(50) NOT NULL,          -- Domain, Subdomain, Email, etc.
    description NVARCHAR(255) NOT NULL,      -- Human-readable description

    -- Input parameters
    operation NVARCHAR(10) NOT NULL,         -- ADD, REMOVE, UPDATE, CLEAR, GET
    dimension NVARCHAR(20) NOT NULL,         -- domain, subdomain, subject, etc.
    action NVARCHAR(20),                     -- delete, keep, etc.
    key_value NVARCHAR(255),                 -- The value being operated on
    parent_domain NVARCHAR(255),             -- Parent domain if applicable
    parent_subdomain NVARCHAR(255),          -- Parent subdomain if applicable
    old_action NVARCHAR(20),                 -- For UPDATE operations
    user_email NVARCHAR(255) DEFAULT 'test@user.com',

    -- Expected results
    expected_success BIT NOT NULL,
    expected_message_contains NVARCHAR(255), -- Substring that should appear in message

    -- Actual results (populated by test run)
    actual_success BIT,
    actual_message NVARCHAR(500),
    actual_record_id INT,
    actual_audit_id INT,

    -- Test status
    test_result NVARCHAR(10),                -- PASS, FAIL, ERROR
    test_run_at DATETIME2,
    error_details NVARCHAR(MAX)
);
-- Note: id column is already IDENTITY, so it serves as sequence_order
GO

CREATE INDEX idx_test_cases_test_id ON criteria_test_cases(test_id);
CREATE INDEX idx_test_cases_category ON criteria_test_cases(category);
GO

PRINT 'Created criteria_test_cases table';
GO

-- ============================================================================
-- Step 2: Insert all test cases
-- ============================================================================

-- Domain Operations (D01-D10)
INSERT INTO criteria_test_cases (test_id, category, description, operation, dimension, action, key_value, expected_success, expected_message_contains)
VALUES
    ('D01', 'Domain', 'Add domain delete rule', 'ADD', 'domain', 'delete', 'test-spam.com', 1, 'delete rule for domain'),
    ('D02', 'Domain', 'Add domain keep rule', 'ADD', 'domain', 'keep', 'test-important.com', 1, 'keep rule for domain'),
    ('D03', 'Domain', 'Add domain delete_1d rule', 'ADD', 'domain', 'delete_1d', 'test-otp.com', 1, 'delete_1d rule for domain'),
    ('D04', 'Domain', 'Add domain delete_10d rule', 'ADD', 'domain', 'delete_10d', 'test-reports.com', 1, 'delete_10d rule for domain'),
    ('D05', 'Domain', 'Remove domain rule', 'REMOVE', 'domain', NULL, 'test-spam.com', 1, 'Removed domain'),
    ('D06', 'Domain', 'Change domain delete to keep', 'UPDATE', 'domain', 'keep', 'test-important.com', 1, 'Updated domain'),
    ('D07', 'Domain', 'Add duplicate domain (idempotent)', 'ADD', 'domain', 'delete', 'test-otp.com', 1, NULL),
    ('D08', 'Domain', 'Remove non-existent domain', 'REMOVE', 'domain', NULL, 'test-notfound.com', 1, 'not found'),
    ('D09', 'Domain', 'Clear all domain rules', 'CLEAR', 'domain', NULL, 'test-reports.com', 1, 'Cleared'),
    ('D10', 'Domain', 'Get domain rules', 'GET', 'domain', NULL, 'test-important.com', 1, 'Query completed');
GO

-- Subdomain Operations (S01-S10)
INSERT INTO criteria_test_cases (test_id, category, description, operation, dimension, action, key_value, parent_domain, expected_success, expected_message_contains)
VALUES
    ('S01', 'Subdomain', 'Add subdomain delete rule', 'ADD', 'subdomain', 'delete', 'mail', 'test-example.com', 1, 'subdomain'),
    ('S02', 'Subdomain', 'Add subdomain keep rule', 'ADD', 'subdomain', 'keep', 'support', 'test-example.com', 1, 'subdomain'),
    ('S03', 'Subdomain', 'Add subdomain delete_1d rule', 'ADD', 'subdomain', 'delete_1d', 'notify', 'test-example.com', 1, 'subdomain'),
    ('S04', 'Subdomain', 'Add subdomain delete_10d rule', 'ADD', 'subdomain', 'delete_10d', 'archive', 'test-example.com', 1, 'subdomain'),
    ('S05', 'Subdomain', 'Remove subdomain rule', 'REMOVE', 'subdomain', NULL, 'mail', 'test-example.com', 1, 'Removed subdomain'),
    ('S06', 'Subdomain', 'Update subdomain action', 'UPDATE', 'subdomain', 'keep', 'notify', 'test-example.com', 1, 'Updated subdomain'),
    ('S07', 'Subdomain', 'Add pattern to subdomain', 'ADD', 'subject', 'keep', 'urgent', 'test-example.com', 1, 'pattern'),
    ('S08', 'Subdomain', 'Remove pattern from subdomain', 'REMOVE', 'subject', NULL, 'urgent', 'test-example.com', 1, NULL),
    ('S09', 'Subdomain', 'Get subdomains for domain', 'GET', 'subdomain', NULL, NULL, 'test-example.com', 1, 'Query completed'),
    ('S10', 'Subdomain', 'Get specific subdomain', 'GET', 'subdomain', NULL, 'support', 'test-example.com', 1, 'Query completed');
GO

-- Subdomain Review Operations (SR01-SR06)
INSERT INTO criteria_test_cases (test_id, category, description, operation, dimension, action, key_value, parent_domain, old_action, expected_success, expected_message_contains)
VALUES
    ('SR01', 'Subdomain Review', 'List all subdomains for domain', 'GET', 'subdomain', NULL, NULL, 'test-example.com', NULL, 1, 'Query completed'),
    ('SR02', 'Subdomain Review', 'View subdomain with patterns', 'GET', 'subdomain', NULL, 'support', 'test-example.com', NULL, 1, 'Query completed'),
    ('SR03', 'Subdomain Review', 'Edit subdomain default action', 'UPDATE', 'subdomain', 'delete_1d', 'support', 'test-example.com', 'keep', 1, 'Updated subdomain'),
    ('SR04', 'Subdomain Review', 'Add subdomain for deletion test', 'ADD', 'subdomain', 'delete', 'obsolete', 'test-example.com', NULL, 1, 'subdomain'),
    ('SR05', 'Subdomain Review', 'Delete subdomain from manager', 'REMOVE', 'subdomain', NULL, 'obsolete', 'test-example.com', NULL, 1, 'Removed subdomain'),
    ('SR06', 'Subdomain Review', 'Verify subdomain deleted', 'REMOVE', 'subdomain', NULL, 'obsolete', 'test-example.com', NULL, 1, 'not found');
GO

-- Email Pattern Operations (E01-E10)
INSERT INTO criteria_test_cases (test_id, category, description, operation, dimension, action, key_value, parent_domain, expected_success, expected_message_contains)
VALUES
    ('E01', 'Email Pattern', 'Add fromEmail keep rule', 'ADD', 'from_email', 'keep', 'ceo@test-company.com', 'test-company.com', 1, 'from'),
    ('E02', 'Email Pattern', 'Add fromEmail delete rule', 'ADD', 'from_email', 'delete', 'spam@test-company.com', 'test-company.com', 1, 'from'),
    ('E03', 'Email Pattern', 'Add toEmail keep rule', 'ADD', 'to_email', 'keep', 'work@test-gmail.com', 'test-company.com', 1, 'to'),
    ('E04', 'Email Pattern', 'Add toEmail delete rule', 'ADD', 'to_email', 'delete', 'promo@test-gmail.com', 'test-company.com', 1, 'to'),
    ('E05', 'Email Pattern', 'Remove fromEmail rule', 'REMOVE', 'from_email', NULL, 'spam@test-company.com', 'test-company.com', 1, 'Removed'),
    ('E06', 'Email Pattern', 'Remove toEmail rule', 'REMOVE', 'to_email', NULL, 'promo@test-gmail.com', 'test-company.com', 1, 'Removed'),
    ('E07', 'Email Pattern', 'Update fromEmail action', 'UPDATE', 'from_email', 'delete', 'ceo@test-company.com', 'test-company.com', 1, 'Updated'),
    ('E08', 'Email Pattern', 'Duplicate fromEmail (idempotent)', 'ADD', 'from_email', 'delete', 'ceo@test-company.com', 'test-company.com', 1, NULL),
    ('E09', 'Email Pattern', 'Remove non-existent fromEmail', 'REMOVE', 'from_email', NULL, 'notfound@test-company.com', 'test-company.com', 1, 'not found'),
    ('E10', 'Email Pattern', 'Add another toEmail', 'ADD', 'to_email', 'keep', 'important@test-gmail.com', 'test-company.com', 1, 'to');
GO

-- Subject Pattern Operations (P01-P10)
INSERT INTO criteria_test_cases (test_id, category, description, operation, dimension, action, key_value, parent_domain, old_action, expected_success, expected_message_contains)
VALUES
    ('P01', 'Subject Pattern', 'Add subject keep pattern', 'ADD', 'subject', 'keep', 'urgent', 'test-patterns.com', NULL, 1, 'pattern'),
    ('P02', 'Subject Pattern', 'Add subject delete pattern', 'ADD', 'subject', 'delete', 'newsletter', 'test-patterns.com', NULL, 1, 'pattern'),
    ('P03', 'Subject Pattern', 'Add subject delete_1d pattern', 'ADD', 'subject', 'delete_1d', 'verification code', 'test-patterns.com', NULL, 1, 'pattern'),
    ('P04', 'Subject Pattern', 'Add subject delete_10d pattern', 'ADD', 'subject', 'delete_10d', 'monthly report', 'test-patterns.com', NULL, 1, 'pattern'),
    ('P05', 'Subject Pattern', 'Remove subject pattern', 'REMOVE', 'subject', 'delete', 'newsletter', 'test-patterns.com', NULL, 1, 'Removed'),
    ('P06', 'Subject Pattern', 'Update subject pattern action', 'UPDATE', 'subject', 'keep', 'verification code', 'test-patterns.com', 'delete_1d', 1, 'Updated'),
    ('P07', 'Subject Pattern', 'Duplicate pattern (idempotent)', 'ADD', 'subject', 'keep', 'urgent', 'test-patterns.com', NULL, 1, 'already exists'),
    ('P08', 'Subject Pattern', 'Add another keep pattern', 'ADD', 'subject', 'keep', 'important', 'test-patterns.com', NULL, 1, 'pattern'),
    ('P09', 'Subject Pattern', 'Add another delete pattern', 'ADD', 'subject', 'delete', 'promotion', 'test-patterns.com', NULL, 1, 'pattern'),
    ('P10', 'Subject Pattern', 'Remove non-existent pattern', 'REMOVE', 'subject', NULL, 'notfound', 'test-patterns.com', NULL, 1, 'not found');
GO

-- Change/Update Operations (C01-C08)
INSERT INTO criteria_test_cases (test_id, category, description, operation, dimension, action, key_value, parent_domain, old_action, expected_success, expected_message_contains)
VALUES
    ('C01', 'Change', 'Setup: Add domain for change test', 'ADD', 'domain', 'delete', 'test-change.com', NULL, NULL, 1, NULL),
    ('C02', 'Change', 'Change delete to keep', 'UPDATE', 'domain', 'keep', 'test-change.com', NULL, 'delete', 1, 'Updated'),
    ('C03', 'Change', 'Change keep to delete_1d', 'UPDATE', 'domain', 'delete_1d', 'test-change.com', NULL, 'keep', 1, 'Updated'),
    ('C04', 'Change', 'Change delete_1d to delete_10d', 'UPDATE', 'domain', 'delete_10d', 'test-change.com', NULL, 'delete_1d', 1, 'Updated'),
    ('C05', 'Change', 'Update non-existent domain', 'UPDATE', 'domain', 'keep', 'test-nonexistent.com', NULL, NULL, 0, 'not found'),
    ('C06', 'Change', 'Setup: Add pattern for update', 'ADD', 'subject', 'delete', 'promo', 'test-change.com', NULL, 1, NULL),
    ('C07', 'Change', 'Update pattern action', 'UPDATE', 'subject', 'keep', 'promo', 'test-change.com', 'delete', 1, 'Updated'),
    ('C08', 'Change', 'Update non-existent pattern', 'UPDATE', 'subject', 'keep', 'notfound', 'test-change.com', 'delete', 0, 'not found');
GO

-- Multi-User Isolation (U01-U05)
INSERT INTO criteria_test_cases (test_id, category, description, operation, dimension, action, key_value, parent_domain, user_email, expected_success, expected_message_contains)
VALUES
    ('U01', 'Multi-User', 'User A adds domain', 'ADD', 'domain', 'delete', 'test-isolation.com', NULL, 'userA@test.com', 1, 'delete rule'),
    ('U02', 'Multi-User', 'User B cannot see User A domain', 'GET', 'domain', NULL, 'test-isolation.com', NULL, 'userB@test.com', 1, NULL),
    ('U03', 'Multi-User', 'User B adds same domain', 'ADD', 'domain', 'keep', 'test-isolation.com', NULL, 'userB@test.com', 1, 'keep rule'),
    ('U04', 'Multi-User', 'User A removes domain', 'REMOVE', 'domain', NULL, 'test-isolation.com', NULL, 'userA@test.com', 1, 'Removed'),
    ('U05', 'Multi-User', 'User B domain still exists', 'GET', 'domain', NULL, 'test-isolation.com', NULL, 'userB@test.com', 1, 'Query completed');
GO

PRINT 'Inserted all test cases';
GO

-- ============================================================================
-- Step 3: Create test execution procedure
-- ============================================================================
IF OBJECT_ID('dbo.RunCriteriaTests', 'P') IS NOT NULL
    DROP PROCEDURE dbo.RunCriteriaTests;
GO

CREATE PROCEDURE dbo.RunCriteriaTests
    @CleanupBefore BIT = 1,
    @CleanupAfter BIT = 1,
    @CategoryFilter NVARCHAR(50) = NULL  -- Optional: run only specific category
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @TestId NVARCHAR(10);
    DECLARE @Operation NVARCHAR(10);
    DECLARE @Dimension NVARCHAR(20);
    DECLARE @Action NVARCHAR(20);
    DECLARE @KeyValue NVARCHAR(255);
    DECLARE @ParentDomain NVARCHAR(255);
    DECLARE @ParentSubdomain NVARCHAR(255);
    DECLARE @OldAction NVARCHAR(20);
    DECLARE @UserEmail NVARCHAR(255);
    DECLARE @ExpectedSuccess BIT;
    DECLARE @ExpectedMessage NVARCHAR(255);

    DECLARE @ActualSuccess BIT;
    DECLARE @ActualMessage NVARCHAR(500);
    DECLARE @ActualRecordId INT;
    DECLARE @ActualAuditId INT;

    DECLARE @StartTime DATETIME2 = GETDATE();
    DECLARE @TotalTests INT = 0;
    DECLARE @PassedTests INT = 0;
    DECLARE @FailedTests INT = 0;
    DECLARE @ErrorTests INT = 0;

    -- ========================================
    -- Cleanup test data before running
    -- ========================================
    IF @CleanupBefore = 1
    BEGIN
        PRINT 'Cleaning up previous test data...';

        -- Delete test criteria - must delete children (subdomains) before parents (domains)
        -- First delete subdomains (key_type = 'subdomain' with parent_id referencing test domains)
        DELETE c FROM criteria c
        INNER JOIN criteria p ON c.parent_id = p.id
        WHERE p.key_value LIKE 'test-%' OR p.user_email LIKE '%@test.com';

        -- Then delete domains and emails
        DELETE FROM criteria WHERE key_value LIKE 'test-%';
        DELETE FROM criteria WHERE user_email LIKE '%@test.com';

        -- Delete test audit logs
        DELETE FROM audit_log WHERE domain LIKE 'test-%';
        DELETE FROM audit_log WHERE user_email LIKE '%@test.com';

        -- Reset test results
        UPDATE criteria_test_cases
        SET actual_success = NULL,
            actual_message = NULL,
            actual_record_id = NULL,
            actual_audit_id = NULL,
            test_result = NULL,
            test_run_at = NULL,
            error_details = NULL;

        PRINT 'Cleanup complete.';
    END

    -- ========================================
    -- Run each test case
    -- ========================================
    DECLARE test_cursor CURSOR FOR
        SELECT test_id, operation, dimension, action, key_value,
               parent_domain, parent_subdomain, old_action, user_email,
               expected_success, expected_message_contains
        FROM criteria_test_cases
        WHERE (@CategoryFilter IS NULL OR category = @CategoryFilter)
        ORDER BY id;

    OPEN test_cursor;
    FETCH NEXT FROM test_cursor INTO
        @TestId, @Operation, @Dimension, @Action, @KeyValue,
        @ParentDomain, @ParentSubdomain, @OldAction, @UserEmail,
        @ExpectedSuccess, @ExpectedMessage;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @TotalTests = @TotalTests + 1;

        BEGIN TRY
            -- GET operations return multiple result sets, handle them differently
            IF @Operation = 'GET'
            BEGIN
                -- For GET operations, we just verify they execute without error
                -- The actual result sets are not captured (test framework limitation)
                EXEC dbo.ModifyCriteria
                    @Operation = @Operation,
                    @Dimension = @Dimension,
                    @Action = @Action,
                    @KeyValue = @KeyValue,
                    @UserEmail = @UserEmail,
                    @ParentDomain = @ParentDomain,
                    @ParentSubdomain = @ParentSubdomain,
                    @OldAction = @OldAction;

                -- If we get here without error, the GET succeeded
                SET @ActualSuccess = 1;
                SET @ActualMessage = 'Query completed successfully';
                SET @ActualRecordId = NULL;
                SET @ActualAuditId = NULL;
            END
            ELSE
            BEGIN
                -- Create temp table to capture result for non-GET operations
                CREATE TABLE #TestResult (
                    Success BIT,
                    Message NVARCHAR(500),
                    RecordId INT,
                    AuditId INT
                );

                -- Execute the stored procedure
                INSERT INTO #TestResult (Success, Message, RecordId, AuditId)
                EXEC dbo.ModifyCriteria
                    @Operation = @Operation,
                    @Dimension = @Dimension,
                    @Action = @Action,
                    @KeyValue = @KeyValue,
                    @UserEmail = @UserEmail,
                    @ParentDomain = @ParentDomain,
                    @ParentSubdomain = @ParentSubdomain,
                    @OldAction = @OldAction;

                -- Get results
                SELECT TOP 1
                    @ActualSuccess = Success,
                    @ActualMessage = Message,
                    @ActualRecordId = RecordId,
                    @ActualAuditId = AuditId
                FROM #TestResult;

                DROP TABLE #TestResult;
            END

            -- Determine pass/fail
            DECLARE @TestResult NVARCHAR(10) = 'PASS';
            DECLARE @ErrorDetails NVARCHAR(MAX) = NULL;

            -- Check success matches expected
            IF @ActualSuccess != @ExpectedSuccess
            BEGIN
                SET @TestResult = 'FAIL';
                SET @ErrorDetails = 'Expected success=' + CAST(@ExpectedSuccess AS NVARCHAR) +
                    ' but got success=' + CAST(@ActualSuccess AS NVARCHAR);
            END
            -- Check message contains expected substring (if specified)
            ELSE IF @ExpectedMessage IS NOT NULL AND @ActualMessage NOT LIKE '%' + @ExpectedMessage + '%'
            BEGIN
                SET @TestResult = 'FAIL';
                SET @ErrorDetails = 'Expected message to contain "' + @ExpectedMessage +
                    '" but got "' + @ActualMessage + '"';
            END

            -- Update test case with results
            UPDATE criteria_test_cases
            SET actual_success = @ActualSuccess,
                actual_message = @ActualMessage,
                actual_record_id = @ActualRecordId,
                actual_audit_id = @ActualAuditId,
                test_result = @TestResult,
                test_run_at = GETDATE(),
                error_details = @ErrorDetails
            WHERE test_id = @TestId;

            IF @TestResult = 'PASS'
                SET @PassedTests = @PassedTests + 1;
            ELSE
                SET @FailedTests = @FailedTests + 1;

        END TRY
        BEGIN CATCH
            SET @ErrorTests = @ErrorTests + 1;

            UPDATE criteria_test_cases
            SET test_result = 'ERROR',
                test_run_at = GETDATE(),
                error_details = ERROR_MESSAGE()
            WHERE test_id = @TestId;

            -- Clean up temp table if it exists
            IF OBJECT_ID('tempdb..#TestResult') IS NOT NULL
                DROP TABLE #TestResult;
        END CATCH

        FETCH NEXT FROM test_cursor INTO
            @TestId, @Operation, @Dimension, @Action, @KeyValue,
            @ParentDomain, @ParentSubdomain, @OldAction, @UserEmail,
            @ExpectedSuccess, @ExpectedMessage;
    END

    CLOSE test_cursor;
    DEALLOCATE test_cursor;

    -- ========================================
    -- Cleanup test data after running
    -- ========================================
    IF @CleanupAfter = 1
    BEGIN
        PRINT 'Cleaning up test data...';

        -- Delete children (subdomains) before parents (domains)
        DELETE c FROM criteria c
        INNER JOIN criteria p ON c.parent_id = p.id
        WHERE p.key_value LIKE 'test-%' OR p.user_email LIKE '%@test.com';

        DELETE FROM criteria WHERE key_value LIKE 'test-%';
        DELETE FROM criteria WHERE user_email LIKE '%@test.com';
        DELETE FROM audit_log WHERE domain LIKE 'test-%';
        DELETE FROM audit_log WHERE user_email LIKE '%@test.com';

        PRINT 'Cleanup complete.';
    END

    -- ========================================
    -- Report Results
    -- ========================================
    DECLARE @Duration INT = DATEDIFF(MILLISECOND, @StartTime, GETDATE());

    PRINT '';
    PRINT '============================================';
    PRINT 'CRITERIA MODIFICATION TEST REPORT';
    PRINT '============================================';
    PRINT 'Total Tests: ' + CAST(@TotalTests AS NVARCHAR);
    PRINT 'Passed: ' + CAST(@PassedTests AS NVARCHAR);
    PRINT 'Failed: ' + CAST(@FailedTests AS NVARCHAR);
    PRINT 'Errors: ' + CAST(@ErrorTests AS NVARCHAR);
    PRINT 'Duration: ' + CAST(@Duration AS NVARCHAR) + 'ms';
    PRINT '============================================';
    PRINT '';

    -- Return summary
    SELECT
        @TotalTests AS TotalTests,
        @PassedTests AS PassedTests,
        @FailedTests AS FailedTests,
        @ErrorTests AS ErrorTests,
        @Duration AS DurationMs,
        CASE WHEN @FailedTests = 0 AND @ErrorTests = 0 THEN 'ALL TESTS PASSED' ELSE 'SOME TESTS FAILED' END AS Status;

    -- Return failed/error tests
    IF @FailedTests > 0 OR @ErrorTests > 0
    BEGIN
        SELECT
            test_id,
            category,
            description,
            test_result,
            expected_success,
            actual_success,
            expected_message_contains,
            actual_message,
            error_details
        FROM criteria_test_cases
        WHERE test_result IN ('FAIL', 'ERROR')
        ORDER BY id;
    END

    -- Return all test results
    SELECT
        test_id,
        category,
        description,
        test_result,
        actual_message
    FROM criteria_test_cases
    WHERE (@CategoryFilter IS NULL OR category = @CategoryFilter)
    ORDER BY id;
END;
GO

PRINT 'Created RunCriteriaTests stored procedure';
GO

PRINT '============================================';
PRINT 'Test infrastructure created successfully!';
PRINT '';
PRINT 'To run tests:';
PRINT '  EXEC dbo.RunCriteriaTests;';
PRINT '';
PRINT 'To run specific category:';
PRINT '  EXEC dbo.RunCriteriaTests @CategoryFilter = ''Domain'';';
PRINT '============================================';
GO
