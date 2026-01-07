/**
 * Multi-User Isolation Tests
 *
 * Tests that verify user data isolation at the database level.
 * These tests ensure that User A cannot see or modify User B's data.
 *
 * See ADR-002 for decision rationale.
 *
 * Usage:
 *   docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
 *     -S localhost -U sa -P "MyPass@word123" -C -d GmailCriteria \
 *     -i /tmp/08-multi-user-tests.sql
 */

USE GmailCriteria;
GO

PRINT '========================================';
PRINT 'Multi-User Isolation Tests';
PRINT '========================================';
PRINT '';

-- Cleanup test data
DELETE FROM pending_emails WHERE user_email LIKE '%@test.com';
DELETE FROM criteria WHERE user_email LIKE '%@test.com';
DELETE FROM patterns WHERE user_email LIKE '%@test.com';
DELETE FROM email_patterns WHERE user_email LIKE '%@test.com';

PRINT 'Test data cleaned up';
PRINT '';

-- ============================================
-- TEST SUITE 1: Pending Emails Isolation
-- ============================================

PRINT '--- TEST SUITE 1: Pending Emails Isolation ---';
PRINT '';

-- Setup: Insert test emails for two users
INSERT INTO pending_emails (GmailId, user_email, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate, ReceivedAt)
VALUES
  ('test-a-1', 'user-a@test.com', 'sender@shop.com', 'user-a@test.com', 'User A Email 1', 'shop.com', NULL, GETDATE(), GETDATE()),
  ('test-a-2', 'user-a@test.com', 'sender@shop.com', 'user-a@test.com', 'User A Email 2', 'shop.com', NULL, GETDATE(), GETDATE()),
  ('test-b-1', 'user-b@test.com', 'sender@other.com', 'user-b@test.com', 'User B Email', 'other.com', NULL, GETDATE(), GETDATE());

PRINT 'Test emails inserted: 2 for User A, 1 for User B';

-- Test 1.1: User A count
DECLARE @countA INT;
SELECT @countA = COUNT(*) FROM pending_emails WHERE user_email = 'user-a@test.com';

IF @countA = 2
  PRINT 'TEST 1.1 PASS: User A sees exactly 2 emails';
ELSE
  PRINT 'TEST 1.1 FAIL: User A sees ' + CAST(@countA AS VARCHAR) + ' emails (expected 2)';

-- Test 1.2: User B count
DECLARE @countB INT;
SELECT @countB = COUNT(*) FROM pending_emails WHERE user_email = 'user-b@test.com';

IF @countB = 1
  PRINT 'TEST 1.2 PASS: User B sees exactly 1 email';
ELSE
  PRINT 'TEST 1.2 FAIL: User B sees ' + CAST(@countB AS VARCHAR) + ' emails (expected 1)';

-- Test 1.3: User A cannot see User B's emails
DECLARE @crossCount INT;
SELECT @crossCount = COUNT(*) FROM pending_emails
WHERE user_email = 'user-a@test.com' AND FromEmail = 'sender@other.com';

IF @crossCount = 0
  PRINT 'TEST 1.3 PASS: User A cannot see User B emails';
ELSE
  PRINT 'TEST 1.3 FAIL: User A can see ' + CAST(@crossCount AS VARCHAR) + ' of User B emails';

PRINT '';

-- ============================================
-- TEST SUITE 2: Stored Procedure Isolation
-- ============================================

PRINT '--- TEST SUITE 2: Stored Procedure Isolation ---';
PRINT '';

-- Setup: Add criteria for User A only
INSERT INTO criteria (user_email, PrimaryDomain, Subdomain, DefaultAction)
VALUES ('user-a@test.com', 'shop.com', NULL, 'delete');

PRINT 'Criteria added: shop.com -> delete (User A only)';

-- Test 2.1: Evaluate only User A's emails
EXEC dbo.EvaluatePendingEmails @UserEmail = 'user-a@test.com';

-- Check User A's emails were evaluated
DECLARE @evaluatedA INT;
SELECT @evaluatedA = COUNT(*) FROM pending_emails
WHERE user_email = 'user-a@test.com' AND Action IS NOT NULL;

IF @evaluatedA = 2
  PRINT 'TEST 2.1 PASS: User A emails evaluated (2 of 2)';
ELSE
  PRINT 'TEST 2.1 FAIL: Only ' + CAST(@evaluatedA AS VARCHAR) + ' of User A emails evaluated';

-- Test 2.2: User B's emails NOT evaluated
DECLARE @evaluatedB INT;
SELECT @evaluatedB = COUNT(*) FROM pending_emails
WHERE user_email = 'user-b@test.com' AND Action IS NOT NULL;

IF @evaluatedB = 0
  PRINT 'TEST 2.2 PASS: User B emails NOT evaluated (as expected)';
ELSE
  PRINT 'TEST 2.2 FAIL: ' + CAST(@evaluatedB AS VARCHAR) + ' of User B emails were incorrectly evaluated';

-- Test 2.3: User A's emails got correct action
DECLARE @deleteCountA INT;
SELECT @deleteCountA = COUNT(*) FROM pending_emails
WHERE user_email = 'user-a@test.com' AND Action = 'delete';

IF @deleteCountA = 2
  PRINT 'TEST 2.3 PASS: User A emails marked for delete';
ELSE
  PRINT 'TEST 2.3 FAIL: Only ' + CAST(@deleteCountA AS VARCHAR) + ' emails marked for delete';

PRINT '';

-- ============================================
-- TEST SUITE 3: Criteria Isolation
-- ============================================

PRINT '--- TEST SUITE 3: Criteria Isolation ---';
PRINT '';

-- Add criteria for User B
INSERT INTO criteria (user_email, PrimaryDomain, Subdomain, DefaultAction)
VALUES ('user-b@test.com', 'other.com', NULL, 'keep');

PRINT 'Criteria added: other.com -> keep (User B only)';

-- Test 3.1: User A cannot see User B's criteria
DECLARE @criteriaCountA INT;
SELECT @criteriaCountA = COUNT(*) FROM criteria
WHERE user_email = 'user-a@test.com' AND PrimaryDomain = 'other.com';

IF @criteriaCountA = 0
  PRINT 'TEST 3.1 PASS: User A cannot see User B criteria';
ELSE
  PRINT 'TEST 3.1 FAIL: User A can see ' + CAST(@criteriaCountA AS VARCHAR) + ' of User B criteria';

-- Test 3.2: User B sees only their criteria
DECLARE @criteriaCountB INT;
SELECT @criteriaCountB = COUNT(*) FROM criteria WHERE user_email = 'user-b@test.com';

IF @criteriaCountB = 1
  PRINT 'TEST 3.2 PASS: User B sees exactly 1 criteria';
ELSE
  PRINT 'TEST 3.2 FAIL: User B sees ' + CAST(@criteriaCountB AS VARCHAR) + ' criteria';

-- Test 3.3: Now evaluate User B
EXEC dbo.EvaluatePendingEmails @UserEmail = 'user-b@test.com';

DECLARE @keepCountB INT;
SELECT @keepCountB = COUNT(*) FROM pending_emails
WHERE user_email = 'user-b@test.com' AND Action = 'keep';

IF @keepCountB = 1
  PRINT 'TEST 3.3 PASS: User B email marked for keep';
ELSE
  PRINT 'TEST 3.3 FAIL: User B email not marked correctly';

PRINT '';

-- ============================================
-- TEST SUITE 4: Cross-User Action Verification
-- ============================================

PRINT '--- TEST SUITE 4: Cross-User Action Verification ---';
PRINT '';

-- Test 4.1: User A actions did not change
DECLARE @finalDeleteA INT;
SELECT @finalDeleteA = COUNT(*) FROM pending_emails
WHERE user_email = 'user-a@test.com' AND Action = 'delete';

IF @finalDeleteA = 2
  PRINT 'TEST 4.1 PASS: User A actions unchanged after User B evaluation';
ELSE
  PRINT 'TEST 4.1 FAIL: User A actions changed to ' + CAST(@finalDeleteA AS VARCHAR);

-- Test 4.2: No cross-contamination in matched rules
DECLARE @crossMatchA INT;
SELECT @crossMatchA = COUNT(*) FROM pending_emails
WHERE user_email = 'user-a@test.com' AND MatchedRule LIKE '%other.com%';

IF @crossMatchA = 0
  PRINT 'TEST 4.2 PASS: User A matched rules do not reference User B criteria';
ELSE
  PRINT 'TEST 4.2 FAIL: User A has ' + CAST(@crossMatchA AS VARCHAR) + ' cross-user matches';

PRINT '';

-- ============================================
-- SUMMARY
-- ============================================

PRINT '========================================';
PRINT 'TEST SUMMARY';
PRINT '========================================';

-- Count test results by checking output
PRINT 'All tests completed. Review output above for PASS/FAIL status.';
PRINT '';

-- Show final state
PRINT 'Final pending_emails state:';
SELECT user_email, GmailId, Action, MatchedRule
FROM pending_emails
WHERE user_email LIKE '%@test.com'
ORDER BY user_email, GmailId;

-- Cleanup
PRINT '';
PRINT 'Cleaning up test data...';
DELETE FROM pending_emails WHERE user_email LIKE '%@test.com';
DELETE FROM criteria WHERE user_email LIKE '%@test.com';
DELETE FROM patterns WHERE user_email LIKE '%@test.com';
DELETE FROM email_patterns WHERE user_email LIKE '%@test.com';
PRINT 'Done.';
GO
