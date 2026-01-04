-- ============================================================================
-- Test Script for EvaluateEmails Stored Procedure
-- ============================================================================
-- This script tests various scenarios to verify the matching priority logic.
-- Run after 03-create-evaluate-procedure.sql
-- ============================================================================

USE GmailCriteria;
GO

PRINT '=== Setting up test data ===';
PRINT '';

-- ============================================================================
-- Create test criteria entries
-- ============================================================================

-- Test domain with default delete and keep patterns
IF NOT EXISTS (SELECT 1 FROM criteria WHERE key_value = 'testdomain.com')
BEGIN
    INSERT INTO criteria (key_value, key_type, default_action)
    VALUES ('testdomain.com', 'domain', 'delete');

    DECLARE @testDomainId INT = SCOPE_IDENTITY();

    -- Add keep patterns
    INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testDomainId, 'keep', 'Order Confirmation');
    INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testDomainId, 'keep', 'Receipt');

    -- Add fromEmails rules
    INSERT INTO email_patterns (criteria_id, direction, action, email) VALUES (@testDomainId, 'from', 'keep', 'vip@testdomain.com');
    INSERT INTO email_patterns (criteria_id, direction, action, email) VALUES (@testDomainId, 'from', 'delete', 'spam@testdomain.com');

    -- Add subdomain with different rules
    INSERT INTO criteria (key_value, key_type, default_action, parent_id)
    VALUES ('alerts.testdomain.com', 'subdomain', 'keep', @testDomainId);

    DECLARE @subdomainId INT = SCOPE_IDENTITY();
    INSERT INTO patterns (criteria_id, action, pattern) VALUES (@subdomainId, 'delete', 'Weekly Digest');

    PRINT 'Created test domain: testdomain.com with subdomain alerts.testdomain.com';
END
ELSE
    PRINT 'Test domain already exists';

-- Test domain with delete_1d patterns
IF NOT EXISTS (SELECT 1 FROM criteria WHERE key_value = 'otpdomain.com')
BEGIN
    INSERT INTO criteria (key_value, key_type, default_action)
    VALUES ('otpdomain.com', 'domain', NULL);  -- No default = undecided

    DECLARE @otpDomainId INT = SCOPE_IDENTITY();
    INSERT INTO patterns (criteria_id, action, pattern) VALUES (@otpDomainId, 'delete_1d', 'OTP');
    INSERT INTO patterns (criteria_id, action, pattern) VALUES (@otpDomainId, 'delete_1d', 'Verification Code');
    INSERT INTO patterns (criteria_id, action, pattern) VALUES (@otpDomainId, 'keep', 'Account Statement');

    PRINT 'Created test domain: otpdomain.com';
END

-- Test email address as top-level key
IF NOT EXISTS (SELECT 1 FROM criteria WHERE key_value = 'important@gmail.com')
BEGIN
    INSERT INTO criteria (key_value, key_type, default_action)
    VALUES ('important@gmail.com', 'email', 'keep');

    PRINT 'Created test email key: important@gmail.com';
END

PRINT '';
PRINT '=== Running tests ===';
PRINT '';

-- ============================================================================
-- Test 1: Basic scenarios
-- ============================================================================
PRINT 'Test 1: Basic matching scenarios';
PRINT '--------------------------------';

DECLARE @TestEmails dbo.EmailInputType;

INSERT INTO @TestEmails (EmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate)
VALUES
    -- Should DELETE (default action)
    ('E001', 'newsletter@testdomain.com', 'me@gmail.com', 'Weekly Newsletter', 'testdomain.com', NULL, GETDATE()),

    -- Should KEEP (subject pattern match)
    ('E002', 'orders@testdomain.com', 'me@gmail.com', 'Your Order Confirmation #12345', 'testdomain.com', NULL, GETDATE()),

    -- Should KEEP (subject pattern match - Receipt)
    ('E003', 'billing@testdomain.com', 'me@gmail.com', 'Payment Receipt for January', 'testdomain.com', NULL, GETDATE()),

    -- Should KEEP (fromEmails.keep)
    ('E004', 'vip@testdomain.com', 'me@gmail.com', 'Random Subject', 'testdomain.com', NULL, GETDATE()),

    -- Should DELETE (fromEmails.delete overrides default)
    ('E005', 'spam@testdomain.com', 'me@gmail.com', 'You won a prize!', 'testdomain.com', NULL, GETDATE()),

    -- Should KEEP (subdomain default is keep)
    ('E006', 'noreply@alerts.testdomain.com', 'me@gmail.com', 'System Alert', 'testdomain.com', 'alerts.testdomain.com', GETDATE()),

    -- Should DELETE (subdomain pattern overrides subdomain default)
    ('E007', 'noreply@alerts.testdomain.com', 'me@gmail.com', 'Weekly Digest Summary', 'testdomain.com', 'alerts.testdomain.com', GETDATE()),

    -- Should DELETE_1D (pattern match)
    ('E008', 'security@otpdomain.com', 'me@gmail.com', 'Your OTP is 123456', 'otpdomain.com', NULL, GETDATE()),

    -- Should KEEP (email key takes priority)
    ('E009', 'important@gmail.com', 'me@gmail.com', 'Delete this normally', 'gmail.com', NULL, GETDATE()),

    -- Should be UNDECIDED (no matching domain)
    ('E010', 'unknown@randomdomain.xyz', 'me@gmail.com', 'Hello World', 'randomdomain.xyz', NULL, GETDATE());

EXEC dbo.EvaluateEmails @Emails = @TestEmails, @Verbose = 1;

PRINT '';
PRINT '=== Expected Results ===';
PRINT 'E001: delete (default action)';
PRINT 'E002: keep (subject pattern: Order Confirmation)';
PRINT 'E003: keep (subject pattern: Receipt)';
PRINT 'E004: keep (fromEmails.keep: vip@testdomain.com)';
PRINT 'E005: delete (fromEmails.delete: spam@testdomain.com)';
PRINT 'E006: keep (subdomain default)';
PRINT 'E007: delete (subdomain pattern: Weekly Digest)';
PRINT 'E008: delete_1d (pattern: OTP)';
PRINT 'E009: keep (email key: important@gmail.com)';
PRINT 'E010: undecided (domain not in criteria)';
PRINT '';

-- ============================================================================
-- Test 2: Priority verification (fromEmails > subject pattern > default)
-- ============================================================================
PRINT 'Test 2: Priority verification';
PRINT '-----------------------------';

DELETE FROM @TestEmails;

INSERT INTO @TestEmails (EmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate)
VALUES
    -- fromEmails.keep should win over subject delete pattern
    ('P001', 'vip@testdomain.com', 'me@gmail.com', 'Newsletter to Delete', 'testdomain.com', NULL, GETDATE()),

    -- Subject keep pattern should win over default delete
    ('P002', 'random@testdomain.com', 'me@gmail.com', 'Your Order Confirmation', 'testdomain.com', NULL, GETDATE());

EXEC dbo.EvaluateEmails @Emails = @TestEmails, @Verbose = 1;

PRINT '';
PRINT '=== Expected Results ===';
PRINT 'P001: keep (fromEmails.keep wins over everything)';
PRINT 'P002: keep (subject pattern wins over default)';
PRINT '';

-- ============================================================================
-- Test 3: Test with real data from your criteria
-- ============================================================================
PRINT 'Test 3: Real domain test (google.com)';
PRINT '--------------------------------------';

DELETE FROM @TestEmails;

-- Check if google.com exists in criteria
IF EXISTS (SELECT 1 FROM criteria WHERE key_value = 'google.com')
BEGIN
    INSERT INTO @TestEmails (EmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate)
    VALUES
        ('G001', 'noreply@google.com', 'me@gmail.com', 'Your order is confirmed', 'google.com', NULL, GETDATE()),
        ('G002', 'noreply@google.com', 'me@gmail.com', 'Weekly newsletter', 'google.com', NULL, GETDATE());

    EXEC dbo.EvaluateEmails @Emails = @TestEmails, @Verbose = 1;
END
ELSE
    PRINT 'google.com not found in criteria, skipping test';

PRINT '';

-- ============================================================================
-- Test 4: Bulk test with summary
-- ============================================================================
PRINT 'Test 4: Bulk processing test';
PRINT '----------------------------';

DELETE FROM @TestEmails;

-- Generate 100 test emails
DECLARE @i INT = 1;
WHILE @i <= 100
BEGIN
    INSERT INTO @TestEmails (EmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate)
    VALUES (
        'BULK' + CAST(@i AS VARCHAR(10)),
        CASE @i % 4
            WHEN 0 THEN 'vip@testdomain.com'
            WHEN 1 THEN 'spam@testdomain.com'
            WHEN 2 THEN 'random@testdomain.com'
            ELSE 'unknown@randomdomain.xyz'
        END,
        'me@gmail.com',
        CASE @i % 5
            WHEN 0 THEN 'Order Confirmation #' + CAST(@i AS VARCHAR(10))
            WHEN 1 THEN 'Newsletter Issue ' + CAST(@i AS VARCHAR(10))
            WHEN 2 THEN 'Your OTP is ' + CAST(@i AS VARCHAR(10))
            ELSE 'Random subject ' + CAST(@i AS VARCHAR(10))
        END,
        CASE @i % 4
            WHEN 3 THEN 'randomdomain.xyz'
            ELSE 'testdomain.com'
        END,
        NULL,
        DATEADD(DAY, -(@i % 10), GETDATE())
    );
    SET @i = @i + 1;
END

-- Run without verbose to just get summary
EXEC dbo.EvaluateEmails @Emails = @TestEmails, @Verbose = 0;

PRINT '';
PRINT '=== Test Complete ===';
GO
