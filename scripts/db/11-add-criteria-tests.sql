-- ============================================================================
-- Gmail Criteria: AddCriteriaRule Test Cases
-- ============================================================================
-- Tests all scenarios for the AddCriteriaRule stored procedure.
--
-- Run with:
--   docker cp scripts/db/11-add-criteria-tests.sql gmail-sqlserver:/tmp/
--   docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
--     -S localhost -U sa -P "MyPass@word123" -C -d GmailCriteria \
--     -i /tmp/11-add-criteria-tests.sql
-- ============================================================================

USE GmailCriteria;
GO

PRINT '============================================================================';
PRINT 'Starting AddCriteriaRule Tests';
PRINT '============================================================================';
GO

-- ============================================================================
-- Setup: Clean test data
-- ============================================================================
DECLARE @TestUser NVARCHAR(255) = 'test-addcriteria@example.com';

DELETE FROM patterns WHERE criteria_id IN (SELECT id FROM criteria WHERE user_email = @TestUser);
DELETE FROM email_patterns WHERE criteria_id IN (SELECT id FROM criteria WHERE user_email = @TestUser);
DELETE FROM criteria WHERE user_email = @TestUser;

PRINT 'Cleaned up test data for: ' + @TestUser;
GO

-- ============================================================================
-- Test 1: Domain Level - Keep (No Pattern)
-- User clicks on domain grouping, clicks "Keep All"
-- ============================================================================
PRINT '';
PRINT '--- Test 1: Domain Level - Keep (No Pattern) ---';

EXEC dbo.AddCriteriaRule
    @FromEmail = 'noreply@icicibank.com',
    @ToEmail = 'test-addcriteria@example.com',
    @Subject = 'Some email',
    @Action = 'keep',
    @Level = 'domain',
    @SubjectPattern = NULL,
    @UserEmail = 'test-addcriteria@example.com';

-- Verify: domain entry created with default_action = 'keep'
IF EXISTS (
    SELECT 1 FROM criteria
    WHERE key_value = 'icicibank.com'
      AND key_type = 'domain'
      AND default_action = 'keep'
      AND user_email = 'test-addcriteria@example.com'
)
    PRINT 'PASS: Domain entry created with keep action';
ELSE
    PRINT 'FAIL: Domain entry not created correctly';
GO

-- ============================================================================
-- Test 2: Domain Level - Delete with Pattern
-- User clicks domain, selects text "Newsletter", clicks "Delete"
-- ============================================================================
PRINT '';
PRINT '--- Test 2: Domain Level - Delete with Pattern ---';

EXEC dbo.AddCriteriaRule
    @FromEmail = 'news@example.com',
    @ToEmail = 'test-addcriteria@example.com',
    @Subject = 'Weekly Newsletter Edition',
    @Action = 'delete',
    @Level = 'domain',
    @SubjectPattern = 'Newsletter',
    @UserEmail = 'test-addcriteria@example.com';

-- Verify: pattern added to domain
DECLARE @DomainId1 INT;
SELECT @DomainId1 = id FROM criteria
WHERE key_value = 'example.com'
  AND key_type = 'domain'
  AND user_email = 'test-addcriteria@example.com';

IF EXISTS (
    SELECT 1 FROM patterns
    WHERE criteria_id = @DomainId1
      AND pattern = 'newsletter'  -- lowercase
      AND action = 'delete'
)
    PRINT 'PASS: Pattern added to domain entry';
ELSE
    PRINT 'FAIL: Pattern not added correctly';
GO

-- ============================================================================
-- Test 3: Subdomain Level - Keep (No Pattern)
-- Creates parent domain AND subdomain entry
-- ============================================================================
PRINT '';
PRINT '--- Test 3: Subdomain Level - Keep (No Pattern) ---';

EXEC dbo.AddCriteriaRule
    @FromEmail = 'noreply@custcomm.icicibank.com',
    @ToEmail = 'test-addcriteria@example.com',
    @Subject = 'Account update',
    @Action = 'keep',
    @Level = 'subdomain',
    @SubjectPattern = NULL,
    @UserEmail = 'test-addcriteria@example.com';

-- Verify: parent domain exists
DECLARE @ParentId INT;
SELECT @ParentId = id FROM criteria
WHERE key_value = 'icicibank.com'
  AND key_type = 'domain'
  AND user_email = 'test-addcriteria@example.com';

IF @ParentId IS NOT NULL
    PRINT 'PASS: Parent domain entry exists';
ELSE
    PRINT 'FAIL: Parent domain not created';

-- Verify: subdomain entry with correct parent_id and key_type
IF EXISTS (
    SELECT 1 FROM criteria
    WHERE key_value = 'custcomm.icicibank.com'
      AND key_type = 'subdomain'
      AND parent_id = @ParentId
      AND default_action = 'keep'
      AND user_email = 'test-addcriteria@example.com'
)
    PRINT 'PASS: Subdomain entry created with correct parent_id and key_type';
ELSE
    PRINT 'FAIL: Subdomain entry not created correctly';
GO

-- ============================================================================
-- Test 4: Subdomain Level - Delete with Pattern
-- This was the original bug scenario
-- ============================================================================
PRINT '';
PRINT '--- Test 4: Subdomain Level - Delete with Pattern (Original Bug) ---';

EXEC dbo.AddCriteriaRule
    @FromEmail = 'noreply@custcomm.icicibank.com',
    @ToEmail = 'test-addcriteria@example.com',
    @Subject = 'Webinar on Real Estate',
    @Action = 'delete',
    @Level = 'subdomain',
    @SubjectPattern = 'Webinar',
    @UserEmail = 'test-addcriteria@example.com';

-- Verify: pattern added to subdomain (not domain)
DECLARE @SubdomainId INT;
SELECT @SubdomainId = id FROM criteria
WHERE key_value = 'custcomm.icicibank.com'
  AND key_type = 'subdomain'
  AND user_email = 'test-addcriteria@example.com';

IF EXISTS (
    SELECT 1 FROM patterns
    WHERE criteria_id = @SubdomainId
      AND pattern = 'webinar'  -- lowercase
      AND action = 'delete'
)
    PRINT 'PASS: Pattern added to SUBDOMAIN entry (not domain)';
ELSE
    PRINT 'FAIL: Pattern not added to subdomain correctly';
GO

-- ============================================================================
-- Test 5: Add Multiple Patterns to Same Subdomain
-- ============================================================================
PRINT '';
PRINT '--- Test 5: Multiple Patterns on Same Subdomain ---';

EXEC dbo.AddCriteriaRule
    @FromEmail = 'noreply@custcomm.icicibank.com',
    @ToEmail = 'test-addcriteria@example.com',
    @Subject = 'Beware of online fraud',
    @Action = 'delete',
    @Level = 'subdomain',
    @SubjectPattern = 'Beware of online',
    @UserEmail = 'test-addcriteria@example.com';

EXEC dbo.AddCriteriaRule
    @FromEmail = 'noreply@custcomm.icicibank.com',
    @ToEmail = 'test-addcriteria@example.com',
    @Subject = 'Update for your account',
    @Action = 'delete',
    @Level = 'subdomain',
    @SubjectPattern = 'Update for',
    @UserEmail = 'test-addcriteria@example.com';

-- Verify: 3 patterns on subdomain
DECLARE @SubdomainId2 INT;
SELECT @SubdomainId2 = id FROM criteria
WHERE key_value = 'custcomm.icicibank.com'
  AND key_type = 'subdomain'
  AND user_email = 'test-addcriteria@example.com';

DECLARE @PatternCount INT;
SELECT @PatternCount = COUNT(*) FROM patterns WHERE criteria_id = @SubdomainId2;

IF @PatternCount = 3
    PRINT 'PASS: 3 patterns added to same subdomain';
ELSE
    PRINT 'FAIL: Expected 3 patterns, found ' + CAST(@PatternCount AS VARCHAR);
GO

-- ============================================================================
-- Test 6: FROM Email Level - Keep
-- User clicks exact email address
-- ============================================================================
PRINT '';
PRINT '--- Test 6: FROM Email Level - Keep ---';

EXEC dbo.AddCriteriaRule
    @FromEmail = 'ceo@company.com',
    @ToEmail = 'test-addcriteria@example.com',
    @Subject = 'Important Update',
    @Action = 'keep',
    @Level = 'from_email',
    @SubjectPattern = NULL,
    @UserEmail = 'test-addcriteria@example.com';

-- Verify: email entry created with key_type = 'email'
IF EXISTS (
    SELECT 1 FROM criteria
    WHERE key_value = 'ceo@company.com'
      AND key_type = 'email'
      AND default_action = 'keep'
      AND user_email = 'test-addcriteria@example.com'
)
    PRINT 'PASS: Email entry created with key_type=email';
ELSE
    PRINT 'FAIL: Email entry not created correctly';
GO

-- ============================================================================
-- Test 7: TO Email Level - Delete
-- User wants to delete all emails sent to their old address
-- ============================================================================
PRINT '';
PRINT '--- Test 7: TO Email Level - Delete ---';

EXEC dbo.AddCriteriaRule
    @FromEmail = 'newsletter@shop.com',
    @ToEmail = 'myoldaddress@gmail.com',
    @Subject = 'Sale!',
    @Action = 'delete',
    @Level = 'to_email',
    @SubjectPattern = NULL,
    @UserEmail = 'test-addcriteria@example.com';

-- Verify: email_patterns entry created
IF EXISTS (
    SELECT 1 FROM email_patterns ep
    INNER JOIN criteria c ON ep.criteria_id = c.id
    WHERE ep.email = 'myoldaddress@gmail.com'
      AND ep.direction = 'to'
      AND ep.action = 'delete'
      AND c.user_email = 'test-addcriteria@example.com'
)
    PRINT 'PASS: TO email pattern created';
ELSE
    PRINT 'FAIL: TO email pattern not created';
GO

-- ============================================================================
-- Test 8: delete_1d Action
-- ============================================================================
PRINT '';
PRINT '--- Test 8: delete_1d Action ---';

EXEC dbo.AddCriteriaRule
    @FromEmail = 'verify@bank.com',
    @ToEmail = 'test-addcriteria@example.com',
    @Subject = 'Your OTP is 123456',
    @Action = 'delete_1d',
    @Level = 'domain',
    @SubjectPattern = 'OTP',
    @UserEmail = 'test-addcriteria@example.com';

-- Verify: pattern with delete_1d action
DECLARE @BankId INT;
SELECT @BankId = id FROM criteria
WHERE key_value = 'bank.com'
  AND key_type = 'domain'
  AND user_email = 'test-addcriteria@example.com';

IF EXISTS (
    SELECT 1 FROM patterns
    WHERE criteria_id = @BankId
      AND pattern = 'otp'
      AND action = 'delete_1d'
)
    PRINT 'PASS: delete_1d pattern created';
ELSE
    PRINT 'FAIL: delete_1d pattern not created';
GO

-- ============================================================================
-- Test 9: delete_10d Action
-- ============================================================================
PRINT '';
PRINT '--- Test 9: delete_10d Action ---';

EXEC dbo.AddCriteriaRule
    @FromEmail = 'reports@analytics.com',
    @ToEmail = 'test-addcriteria@example.com',
    @Subject = 'Monthly Report',
    @Action = 'delete_10d',
    @Level = 'domain',
    @SubjectPattern = 'Monthly Report',
    @UserEmail = 'test-addcriteria@example.com';

-- Verify: pattern with delete_10d action
DECLARE @AnalyticsId INT;
SELECT @AnalyticsId = id FROM criteria
WHERE key_value = 'analytics.com'
  AND key_type = 'domain'
  AND user_email = 'test-addcriteria@example.com';

IF EXISTS (
    SELECT 1 FROM patterns
    WHERE criteria_id = @AnalyticsId
      AND pattern = 'monthly report'
      AND action = 'delete_10d'
)
    PRINT 'PASS: delete_10d pattern created';
ELSE
    PRINT 'FAIL: delete_10d pattern not created';
GO

-- ============================================================================
-- Test 10: Duplicate Pattern Prevention
-- ============================================================================
PRINT '';
PRINT '--- Test 10: Duplicate Pattern Prevention ---';

-- Add same pattern twice
EXEC dbo.AddCriteriaRule
    @FromEmail = 'news@duplicate.com',
    @ToEmail = 'test-addcriteria@example.com',
    @Subject = 'Newsletter',
    @Action = 'delete',
    @Level = 'domain',
    @SubjectPattern = 'Newsletter',
    @UserEmail = 'test-addcriteria@example.com';

EXEC dbo.AddCriteriaRule
    @FromEmail = 'news@duplicate.com',
    @ToEmail = 'test-addcriteria@example.com',
    @Subject = 'Newsletter',
    @Action = 'delete',
    @Level = 'domain',
    @SubjectPattern = 'Newsletter',
    @UserEmail = 'test-addcriteria@example.com';

-- Verify: only one pattern exists
DECLARE @DuplicateId INT;
SELECT @DuplicateId = id FROM criteria
WHERE key_value = 'duplicate.com'
  AND key_type = 'domain'
  AND user_email = 'test-addcriteria@example.com';

DECLARE @DupPatternCount INT;
SELECT @DupPatternCount = COUNT(*) FROM patterns
WHERE criteria_id = @DuplicateId AND pattern = 'newsletter';

IF @DupPatternCount = 1
    PRINT 'PASS: Duplicate pattern prevented';
ELSE
    PRINT 'FAIL: Expected 1 pattern, found ' + CAST(@DupPatternCount AS VARCHAR);
GO

-- ============================================================================
-- Test 11: Subdomain with NO Subdomain in Email
-- When email is user@domain.com (no subdomain), level='subdomain' should still work
-- ============================================================================
PRINT '';
PRINT '--- Test 11: Level=subdomain but Email Has No Subdomain ---';

EXEC dbo.AddCriteriaRule
    @FromEmail = 'info@simple.com',
    @ToEmail = 'test-addcriteria@example.com',
    @Subject = 'Info email',
    @Action = 'delete',
    @Level = 'subdomain',
    @SubjectPattern = NULL,
    @UserEmail = 'test-addcriteria@example.com';

-- When there's no subdomain, it should create a domain entry
-- Since simple.com has only 1 dot, @FullDomain = @PrimaryDomain = 'simple.com'
IF EXISTS (
    SELECT 1 FROM criteria
    WHERE key_value = 'simple.com'
      AND key_type IN ('domain', 'subdomain')
      AND default_action = 'delete'
      AND user_email = 'test-addcriteria@example.com'
)
    PRINT 'PASS: Entry created for simple domain';
ELSE
    PRINT 'FAIL: Entry not created for simple domain';
GO

-- ============================================================================
-- Test 12: Verify Evaluation Works with AddCriteriaRule Data
-- The ultimate test - can EvaluatePendingEmails find our patterns?
-- ============================================================================
PRINT '';
PRINT '--- Test 12: Evaluation Integration Test ---';

-- Clear pending_emails for test user and insert test email
DELETE FROM pending_emails WHERE user_email = 'test-addcriteria@example.com';

INSERT INTO pending_emails (GmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate, Action, user_email)
VALUES (
    'TEST-EVAL-001',
    'noreply@custcomm.icicibank.com',
    'test-addcriteria@example.com',
    'Webinar on Real Estate Trends',
    'icicibank.com',
    'custcomm.icicibank.com',
    GETDATE(),
    'undecided',
    'test-addcriteria@example.com'
);

-- Evaluate
EXEC dbo.EvaluatePendingEmails @UserEmail = 'test-addcriteria@example.com';

-- Check result
DECLARE @EvalAction NVARCHAR(20);
DECLARE @MatchedRule NVARCHAR(100);

SELECT @EvalAction = Action, @MatchedRule = MatchedRule
FROM pending_emails
WHERE GmailId = 'TEST-EVAL-001';

IF @EvalAction = 'delete'
    PRINT 'PASS: Email evaluated as delete (MatchedRule: ' + ISNULL(@MatchedRule, 'NULL') + ')';
ELSE
    PRINT 'FAIL: Expected delete, got ' + ISNULL(@EvalAction, 'NULL') + ' (MatchedRule: ' + ISNULL(@MatchedRule, 'NULL') + ')';
GO

-- ============================================================================
-- Cleanup
-- ============================================================================
PRINT '';
PRINT '--- Cleanup ---';

DECLARE @TestUser2 NVARCHAR(255) = 'test-addcriteria@example.com';

DELETE FROM pending_emails WHERE user_email = @TestUser2;
DELETE FROM patterns WHERE criteria_id IN (SELECT id FROM criteria WHERE user_email = @TestUser2);
DELETE FROM email_patterns WHERE criteria_id IN (SELECT id FROM criteria WHERE user_email = @TestUser2);
DELETE FROM criteria WHERE user_email = @TestUser2;

PRINT 'Test data cleaned up';
GO

PRINT '';
PRINT '============================================================================';
PRINT 'AddCriteriaRule Tests Complete';
PRINT '============================================================================';
GO
