-- ============================================================================
-- Comprehensive Test Suite for EvaluateEmails Stored Procedure
-- ============================================================================
-- This script creates a complete test scenario covering ALL matching rules:
--
--   1. Email address as top-level key
--   2. fromEmails keep/delete rules
--   3. toEmails keep/delete rules
--   4. Subject keep patterns
--   5. Subject delete patterns
--   6. Subject delete_1d patterns
--   7. Default actions (delete, delete_1d, keep)
--   8. Subdomain rules (override parent)
--   9. No match = undecided
--  10. Priority conflicts (higher priority wins)
--
-- Run this after 03-create-evaluate-procedure.sql
-- ============================================================================

USE GmailCriteria;
GO

PRINT '================================================================';
PRINT '  COMPREHENSIVE TEST SUITE FOR EvaluateEmails';
PRINT '================================================================';
PRINT '';

-- ============================================================================
-- STEP 1: Clean up any existing test data
-- ============================================================================
PRINT 'Step 1: Cleaning up previous test data...';

-- Pattern matches: test-*.com domains, *.test-*.com subdomains, and *@test-*.com emails
-- First delete from child tables (patterns and email_patterns)
DELETE FROM email_patterns WHERE criteria_id IN (
    SELECT id FROM criteria WHERE key_value LIKE 'test-%' OR key_value LIKE '%.test-%' OR key_value LIKE '%@test-%'
);
DELETE FROM patterns WHERE criteria_id IN (
    SELECT id FROM criteria WHERE key_value LIKE 'test-%' OR key_value LIKE '%.test-%' OR key_value LIKE '%@test-%'
);

-- Delete subdomains first (they have parent_id references)
-- Subdomains are like: alerts.test-parent-domain.com, marketing.test-parent-domain.com
DELETE FROM criteria WHERE key_type = 'subdomain' AND key_value LIKE '%.test-%';

-- Delete email keys (like vip@test-email.com)
DELETE FROM criteria WHERE key_type = 'email' AND key_value LIKE '%@test-%';

-- Finally delete parent domains (like test-delete-domain.com, test-archive-domain.com)
DELETE FROM criteria WHERE key_type = 'domain' AND key_value LIKE 'test-%';

-- Also clean up test_emails table
IF OBJECT_ID('test_emails', 'U') IS NOT NULL
    DELETE FROM test_emails WHERE EmailId LIKE '[A-I]%';

PRINT 'Cleanup complete.';
PRINT '';

-- ============================================================================
-- STEP 2: Create test criteria entries
-- ============================================================================
PRINT 'Step 2: Creating test criteria entries...';
PRINT '';

-- ----------------------------------------------------------------------------
-- TEST DOMAIN 1: default = 'delete' with keep patterns
-- Simulates: Delete everything EXCEPT important emails
-- ----------------------------------------------------------------------------
PRINT '  Creating test-delete-domain.com (default: delete, with keep patterns)';

INSERT INTO criteria (key_value, key_type, default_action)
VALUES ('test-delete-domain.com', 'domain', 'delete');

DECLARE @testDeleteDomainId INT = SCOPE_IDENTITY();

-- Keep patterns (exceptions to delete)
INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testDeleteDomainId, 'keep', 'Order Confirmation');
INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testDeleteDomainId, 'keep', 'Payment Receipt');
INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testDeleteDomainId, 'keep', 'Account Statement');

-- fromEmails rules
INSERT INTO email_patterns (criteria_id, direction, action, email) VALUES (@testDeleteDomainId, 'from', 'keep', 'ceo@test-delete-domain.com');
INSERT INTO email_patterns (criteria_id, direction, action, email) VALUES (@testDeleteDomainId, 'from', 'delete', 'spam@test-delete-domain.com');

-- toEmails rules
INSERT INTO email_patterns (criteria_id, direction, action, email) VALUES (@testDeleteDomainId, 'to', 'keep', 'important@mycompany.com');
INSERT INTO email_patterns (criteria_id, direction, action, email) VALUES (@testDeleteDomainId, 'to', 'delete', 'trash@mycompany.com');

-- ----------------------------------------------------------------------------
-- TEST DOMAIN 2: default = 'keep' with delete patterns
-- Simulates: Keep everything EXCEPT newsletters
-- ----------------------------------------------------------------------------
PRINT '  Creating test-keep-domain.com (default: keep, with delete patterns)';

INSERT INTO criteria (key_value, key_type, default_action)
VALUES ('test-keep-domain.com', 'domain', 'keep');

DECLARE @testKeepDomainId INT = SCOPE_IDENTITY();

-- Delete patterns (exceptions to keep)
INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testKeepDomainId, 'delete', 'Newsletter');
INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testKeepDomainId, 'delete', 'Promotional');
INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testKeepDomainId, 'delete', 'Unsubscribe');

-- ----------------------------------------------------------------------------
-- TEST DOMAIN 3: No default (mixed patterns)
-- Simulates: Only specific patterns are decided, rest is undecided
-- ----------------------------------------------------------------------------
PRINT '  Creating test-mixed-domain.com (no default, mixed patterns)';

INSERT INTO criteria (key_value, key_type, default_action)
VALUES ('test-mixed-domain.com', 'domain', NULL);

DECLARE @testMixedDomainId INT = SCOPE_IDENTITY();

INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testMixedDomainId, 'keep', 'Security Alert');
INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testMixedDomainId, 'delete', 'Marketing');
INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testMixedDomainId, 'delete_1d', 'Verification Code');
INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testMixedDomainId, 'delete_1d', 'OTP');
INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testMixedDomainId, 'delete_10d', 'Monthly Report');
INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testMixedDomainId, 'delete_10d', 'Archive Notice');

-- ----------------------------------------------------------------------------
-- TEST DOMAIN 4: With subdomains
-- Parent: default = 'delete'
-- Subdomain alerts: default = 'keep' (opposite of parent)
-- Subdomain marketing: default = 'delete' (same as parent, but different patterns)
-- ----------------------------------------------------------------------------
PRINT '  Creating test-parent-domain.com with subdomains';

INSERT INTO criteria (key_value, key_type, default_action)
VALUES ('test-parent-domain.com', 'domain', 'delete');

DECLARE @testParentDomainId INT = SCOPE_IDENTITY();

INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testParentDomainId, 'keep', 'Invoice');

-- Subdomain: alerts (default keep, with delete exceptions)
INSERT INTO criteria (key_value, key_type, default_action, parent_id)
VALUES ('alerts.test-parent-domain.com', 'subdomain', 'keep', @testParentDomainId);

DECLARE @alertsSubdomainId INT = SCOPE_IDENTITY();

INSERT INTO patterns (criteria_id, action, pattern) VALUES (@alertsSubdomainId, 'delete', 'Weekly Digest');
INSERT INTO patterns (criteria_id, action, pattern) VALUES (@alertsSubdomainId, 'delete', 'Monthly Summary');

-- Subdomain: marketing (default delete, no exceptions)
INSERT INTO criteria (key_value, key_type, default_action, parent_id)
VALUES ('marketing.test-parent-domain.com', 'subdomain', 'delete', @testParentDomainId);

-- Subdomain: notifications (no default, mixed)
INSERT INTO criteria (key_value, key_type, default_action, parent_id)
VALUES ('notifications.test-parent-domain.com', 'subdomain', NULL, @testParentDomainId);

DECLARE @notificationsSubdomainId INT = SCOPE_IDENTITY();

INSERT INTO patterns (criteria_id, action, pattern) VALUES (@notificationsSubdomainId, 'keep', 'Password Reset');
INSERT INTO patterns (criteria_id, action, pattern) VALUES (@notificationsSubdomainId, 'delete_1d', 'Login Alert');

-- ----------------------------------------------------------------------------
-- TEST DOMAIN 5: Email address as top-level key
-- Simulates: Specific sender overrides domain rules
-- ----------------------------------------------------------------------------
PRINT '  Creating test email keys (vip@test-email.com, spam@test-email.com)';

-- First create the domain
INSERT INTO criteria (key_value, key_type, default_action)
VALUES ('test-email.com', 'domain', 'delete');

-- Then create email keys that override domain
INSERT INTO criteria (key_value, key_type, default_action)
VALUES ('vip@test-email.com', 'email', 'keep');

INSERT INTO criteria (key_value, key_type, default_action)
VALUES ('spam@test-email.com', 'email', 'delete');

-- ----------------------------------------------------------------------------
-- TEST DOMAIN 6: delete_1d default
-- Simulates: Domain where everything is deleted after 1 day
-- ----------------------------------------------------------------------------
PRINT '  Creating test-otp-domain.com (default: delete_1d)';

INSERT INTO criteria (key_value, key_type, default_action)
VALUES ('test-otp-domain.com', 'domain', 'delete_1d');

DECLARE @testOtpDomainId INT = SCOPE_IDENTITY();

INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testOtpDomainId, 'keep', 'Account Recovery');

-- ----------------------------------------------------------------------------
-- TEST DOMAIN 7: delete_10d default
-- Simulates: Domain where everything is deleted after 10 days (archive emails)
-- ----------------------------------------------------------------------------
PRINT '  Creating test-archive-domain.com (default: delete_10d)';

INSERT INTO criteria (key_value, key_type, default_action)
VALUES ('test-archive-domain.com', 'domain', 'delete_10d');

DECLARE @testArchiveDomainId INT = SCOPE_IDENTITY();

INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testArchiveDomainId, 'keep', 'Legal Notice');
INSERT INTO patterns (criteria_id, action, pattern) VALUES (@testArchiveDomainId, 'delete', 'Spam Alert');

PRINT '';
PRINT 'Test criteria created successfully.';
PRINT '';

-- ============================================================================
-- STEP 3: Create comprehensive test email set
-- ============================================================================
PRINT 'Step 3: Creating test email set...';
PRINT '';

DECLARE @TestEmails dbo.EmailInputType;

-- ============================================================================
-- TEST CASE GROUP A: Default Delete Domain (test-delete-domain.com)
-- ============================================================================
INSERT INTO @TestEmails (EmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate) VALUES
-- A1: Should DELETE (default action, no pattern match)
('A1', 'random@test-delete-domain.com', 'me@gmail.com', 'Hello World', 'test-delete-domain.com', NULL, GETDATE()),

-- A2: Should KEEP (subject pattern: Order Confirmation)
('A2', 'orders@test-delete-domain.com', 'me@gmail.com', 'Your Order Confirmation #12345', 'test-delete-domain.com', NULL, GETDATE()),

-- A3: Should KEEP (subject pattern: Payment Receipt)
('A3', 'billing@test-delete-domain.com', 'me@gmail.com', 'Payment Receipt for January', 'test-delete-domain.com', NULL, GETDATE()),

-- A4: Should KEEP (subject pattern: Account Statement)
('A4', 'statements@test-delete-domain.com', 'me@gmail.com', 'Your Monthly Account Statement', 'test-delete-domain.com', NULL, GETDATE()),

-- A5: Should KEEP (fromEmails.keep: ceo@)
('A5', 'ceo@test-delete-domain.com', 'me@gmail.com', 'Random Newsletter', 'test-delete-domain.com', NULL, GETDATE()),

-- A6: Should DELETE (fromEmails.delete: spam@) - even if subject has keep pattern
('A6', 'spam@test-delete-domain.com', 'me@gmail.com', 'Order Confirmation Scam', 'test-delete-domain.com', NULL, GETDATE()),

-- A7: Should KEEP (toEmails.keep: important@mycompany.com)
('A7', 'random@test-delete-domain.com', 'important@mycompany.com', 'Some Newsletter', 'test-delete-domain.com', NULL, GETDATE()),

-- A8: Should DELETE (toEmails.delete: trash@mycompany.com)
('A8', 'random@test-delete-domain.com', 'trash@mycompany.com', 'Some Email', 'test-delete-domain.com', NULL, GETDATE());

-- ============================================================================
-- TEST CASE GROUP B: Default Keep Domain (test-keep-domain.com)
-- ============================================================================
INSERT INTO @TestEmails (EmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate) VALUES
-- B1: Should KEEP (default action)
('B1', 'support@test-keep-domain.com', 'me@gmail.com', 'Your Support Ticket', 'test-keep-domain.com', NULL, GETDATE()),

-- B2: Should DELETE (pattern: Newsletter)
('B2', 'news@test-keep-domain.com', 'me@gmail.com', 'Weekly Newsletter Issue #42', 'test-keep-domain.com', NULL, GETDATE()),

-- B3: Should DELETE (pattern: Promotional)
('B3', 'sales@test-keep-domain.com', 'me@gmail.com', 'Promotional Offer Inside!', 'test-keep-domain.com', NULL, GETDATE()),

-- B4: Should DELETE (pattern: Unsubscribe)
('B4', 'mailer@test-keep-domain.com', 'me@gmail.com', 'Click to Unsubscribe', 'test-keep-domain.com', NULL, GETDATE()),

-- B5: Should KEEP (no pattern match, default applies)
('B5', 'info@test-keep-domain.com', 'me@gmail.com', 'Important Account Update', 'test-keep-domain.com', NULL, GETDATE());

-- ============================================================================
-- TEST CASE GROUP C: Mixed Domain (test-mixed-domain.com) - No Default
-- ============================================================================
INSERT INTO @TestEmails (EmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate) VALUES
-- C1: Should KEEP (pattern: Security Alert)
('C1', 'security@test-mixed-domain.com', 'me@gmail.com', 'Security Alert: New Login', 'test-mixed-domain.com', NULL, GETDATE()),

-- C2: Should DELETE (pattern: Marketing)
('C2', 'promo@test-mixed-domain.com', 'me@gmail.com', 'Marketing Campaign Results', 'test-mixed-domain.com', NULL, GETDATE()),

-- C3: Should DELETE_1D (pattern: Verification Code)
('C3', 'auth@test-mixed-domain.com', 'me@gmail.com', 'Your Verification Code is 123456', 'test-mixed-domain.com', NULL, GETDATE()),

-- C4: Should DELETE_1D (pattern: OTP)
('C4', 'otp@test-mixed-domain.com', 'me@gmail.com', 'Your OTP: 789012', 'test-mixed-domain.com', NULL, GETDATE()),

-- C5: Should be UNDECIDED (no pattern match, no default)
('C5', 'random@test-mixed-domain.com', 'me@gmail.com', 'Hello There', 'test-mixed-domain.com', NULL, GETDATE()),

-- C6: Should DELETE_10D (pattern: Monthly Report)
('C6', 'reports@test-mixed-domain.com', 'me@gmail.com', 'Your Monthly Report is Ready', 'test-mixed-domain.com', NULL, GETDATE()),

-- C7: Should DELETE_10D (pattern: Archive Notice)
('C7', 'archive@test-mixed-domain.com', 'me@gmail.com', 'Archive Notice: Old Data', 'test-mixed-domain.com', NULL, GETDATE());

-- ============================================================================
-- TEST CASE GROUP D: Parent Domain with Subdomains (test-parent-domain.com)
-- ============================================================================
INSERT INTO @TestEmails (EmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate) VALUES
-- D1: Parent domain - Should DELETE (parent default)
('D1', 'info@test-parent-domain.com', 'me@gmail.com', 'General Info', 'test-parent-domain.com', NULL, GETDATE()),

-- D2: Parent domain - Should KEEP (pattern: Invoice)
('D2', 'billing@test-parent-domain.com', 'me@gmail.com', 'Invoice #12345', 'test-parent-domain.com', NULL, GETDATE()),

-- D3: Alerts subdomain - Should KEEP (subdomain default = keep)
('D3', 'noreply@alerts.test-parent-domain.com', 'me@gmail.com', 'System Alert', 'test-parent-domain.com', 'alerts.test-parent-domain.com', GETDATE()),

-- D4: Alerts subdomain - Should DELETE (subdomain pattern: Weekly Digest)
('D4', 'digest@alerts.test-parent-domain.com', 'me@gmail.com', 'Your Weekly Digest', 'test-parent-domain.com', 'alerts.test-parent-domain.com', GETDATE()),

-- D5: Alerts subdomain - Should DELETE (subdomain pattern: Monthly Summary)
('D5', 'summary@alerts.test-parent-domain.com', 'me@gmail.com', 'Monthly Summary Report', 'test-parent-domain.com', 'alerts.test-parent-domain.com', GETDATE()),

-- D6: Marketing subdomain - Should DELETE (subdomain default = delete)
('D6', 'campaign@marketing.test-parent-domain.com', 'me@gmail.com', 'New Campaign', 'test-parent-domain.com', 'marketing.test-parent-domain.com', GETDATE()),

-- D7: Notifications subdomain - Should KEEP (pattern: Password Reset)
('D7', 'security@notifications.test-parent-domain.com', 'me@gmail.com', 'Password Reset Request', 'test-parent-domain.com', 'notifications.test-parent-domain.com', GETDATE()),

-- D8: Notifications subdomain - Should DELETE_1D (pattern: Login Alert)
('D8', 'auth@notifications.test-parent-domain.com', 'me@gmail.com', 'Login Alert from New Device', 'test-parent-domain.com', 'notifications.test-parent-domain.com', GETDATE()),

-- D9: Notifications subdomain - Should be UNDECIDED (no pattern, no default)
('D9', 'random@notifications.test-parent-domain.com', 'me@gmail.com', 'Random Notification', 'test-parent-domain.com', 'notifications.test-parent-domain.com', GETDATE());

-- ============================================================================
-- TEST CASE GROUP E: Email Key Override (test-email.com)
-- ============================================================================
INSERT INTO @TestEmails (EmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate) VALUES
-- E1: Should DELETE (domain default, no email key match)
('E1', 'random@test-email.com', 'me@gmail.com', 'Some Email', 'test-email.com', NULL, GETDATE()),

-- E2: Should KEEP (email key: vip@ overrides domain default)
('E2', 'vip@test-email.com', 'me@gmail.com', 'Delete This Normally', 'test-email.com', NULL, GETDATE()),

-- E3: Should DELETE (email key: spam@ with explicit delete)
('E3', 'spam@test-email.com', 'me@gmail.com', 'Win a Prize!', 'test-email.com', NULL, GETDATE());

-- ============================================================================
-- TEST CASE GROUP F: OTP Domain - delete_1d default (test-otp-domain.com)
-- ============================================================================
INSERT INTO @TestEmails (EmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate) VALUES
-- F1: Should DELETE_1D (domain default)
('F1', 'noreply@test-otp-domain.com', 'me@gmail.com', 'Your code is 123456', 'test-otp-domain.com', NULL, GETDATE()),

-- F2: Should KEEP (pattern: Account Recovery overrides default)
('F2', 'security@test-otp-domain.com', 'me@gmail.com', 'Account Recovery Instructions', 'test-otp-domain.com', NULL, GETDATE());

-- ============================================================================
-- TEST CASE GROUP G: Unknown Domain (no criteria)
-- ============================================================================
INSERT INTO @TestEmails (EmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate) VALUES
-- G1: Should be UNDECIDED (domain not in criteria)
('G1', 'someone@unknown-domain.xyz', 'me@gmail.com', 'Hello World', 'unknown-domain.xyz', NULL, GETDATE()),

-- G2: Should be UNDECIDED (another unknown domain)
('G2', 'support@another-unknown.net', 'me@gmail.com', 'Support Ticket', 'another-unknown.net', NULL, GETDATE());

-- ============================================================================
-- TEST CASE GROUP H: Priority Conflicts (higher priority wins)
-- ============================================================================
INSERT INTO @TestEmails (EmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate) VALUES
-- H1: fromEmails.keep beats subject delete pattern (CEo sending newsletter)
-- ceo@ is in fromEmails.keep, but "Newsletter" would normally trigger delete
-- Expected: KEEP (fromEmails.keep > subject pattern)
('H1', 'ceo@test-delete-domain.com', 'me@gmail.com', 'CEO Newsletter', 'test-delete-domain.com', NULL, GETDATE()),

-- H2: Subject keep pattern beats default delete
-- "Order Confirmation" is keep pattern, default is delete
-- Expected: KEEP (subject pattern > default)
('H2', 'random@test-delete-domain.com', 'me@gmail.com', 'Order Confirmation', 'test-delete-domain.com', NULL, GETDATE()),

-- H3: Email key beats domain default
-- vip@ is email key with keep, domain default is delete
-- Expected: KEEP (email key > domain default)
('H3', 'vip@test-email.com', 'me@gmail.com', 'Should Delete by Domain', 'test-email.com', NULL, GETDATE());

-- ============================================================================
-- TEST CASE GROUP I: Archive Domain - delete_10d default (test-archive-domain.com)
-- ============================================================================
INSERT INTO @TestEmails (EmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate) VALUES
-- I1: Should DELETE_10D (domain default)
('I1', 'noreply@test-archive-domain.com', 'me@gmail.com', 'Your data has been archived', 'test-archive-domain.com', NULL, GETDATE()),

-- I2: Should KEEP (pattern: Legal Notice overrides default)
('I2', 'legal@test-archive-domain.com', 'me@gmail.com', 'Important Legal Notice', 'test-archive-domain.com', NULL, GETDATE()),

-- I3: Should DELETE (pattern: Spam Alert - immediate delete overrides 10d default)
('I3', 'security@test-archive-domain.com', 'me@gmail.com', 'Spam Alert Detected', 'test-archive-domain.com', NULL, GETDATE());

PRINT 'Test emails created: ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' total';
PRINT '';

-- ============================================================================
-- STEP 4: Execute the stored procedure
-- ============================================================================
PRINT 'Step 4: Executing EvaluateEmails stored procedure...';
PRINT '';

EXEC dbo.EvaluateEmails @Emails = @TestEmails, @Verbose = 1;

-- ============================================================================
-- STEP 5: Display expected results for verification
-- ============================================================================
PRINT '';
PRINT '================================================================';
PRINT '  EXPECTED RESULTS';
PRINT '================================================================';
PRINT '';
PRINT '  GROUP A: Default Delete Domain (test-delete-domain.com)';
PRINT '  --------------------------------------------------------';
PRINT '  A1: delete     (default action)';
PRINT '  A2: keep       (pattern: Order Confirmation)';
PRINT '  A3: keep       (pattern: Payment Receipt)';
PRINT '  A4: keep       (pattern: Account Statement)';
PRINT '  A5: keep       (fromEmails.keep: ceo@)';
PRINT '  A6: delete     (fromEmails.delete: spam@ - beats pattern)';
PRINT '  A7: keep       (toEmails.keep: important@mycompany.com)';
PRINT '  A8: delete     (toEmails.delete: trash@mycompany.com)';
PRINT '';
PRINT '  GROUP B: Default Keep Domain (test-keep-domain.com)';
PRINT '  ----------------------------------------------------';
PRINT '  B1: keep       (default action)';
PRINT '  B2: delete     (pattern: Newsletter)';
PRINT '  B3: delete     (pattern: Promotional)';
PRINT '  B4: delete     (pattern: Unsubscribe)';
PRINT '  B5: keep       (default action)';
PRINT '';
PRINT '  GROUP C: Mixed Domain (test-mixed-domain.com)';
PRINT '  ----------------------------------------------';
PRINT '  C1: keep       (pattern: Security Alert)';
PRINT '  C2: delete     (pattern: Marketing)';
PRINT '  C3: delete_1d  (pattern: Verification Code)';
PRINT '  C4: delete_1d  (pattern: OTP)';
PRINT '  C5: undecided  (no match, no default)';
PRINT '  C6: delete_10d (pattern: Monthly Report)';
PRINT '  C7: delete_10d (pattern: Archive Notice)';
PRINT '';
PRINT '  GROUP D: Subdomains (test-parent-domain.com)';
PRINT '  ---------------------------------------------';
PRINT '  D1: delete     (parent default)';
PRINT '  D2: keep       (parent pattern: Invoice)';
PRINT '  D3: keep       (alerts subdomain default)';
PRINT '  D4: delete     (alerts pattern: Weekly Digest)';
PRINT '  D5: delete     (alerts pattern: Monthly Summary)';
PRINT '  D6: delete     (marketing subdomain default)';
PRINT '  D7: keep       (notifications pattern: Password Reset)';
PRINT '  D8: delete_1d  (notifications pattern: Login Alert)';
PRINT '  D9: undecided  (notifications: no match, no default)';
PRINT '';
PRINT '  GROUP E: Email Key Override (test-email.com)';
PRINT '  ---------------------------------------------';
PRINT '  E1: delete     (domain default)';
PRINT '  E2: keep       (email key: vip@)';
PRINT '  E3: delete     (email key: spam@)';
PRINT '';
PRINT '  GROUP F: OTP Domain (test-otp-domain.com)';
PRINT '  ------------------------------------------';
PRINT '  F1: delete_1d  (default action)';
PRINT '  F2: keep       (pattern: Account Recovery)';
PRINT '';
PRINT '  GROUP G: Unknown Domain';
PRINT '  ------------------------';
PRINT '  G1: undecided  (domain not in criteria)';
PRINT '  G2: undecided  (domain not in criteria)';
PRINT '';
PRINT '  GROUP H: Priority Conflicts';
PRINT '  ----------------------------';
PRINT '  H1: keep       (fromEmails.keep > pattern)';
PRINT '  H2: keep       (pattern > default)';
PRINT '  H3: keep       (email key > domain)';
PRINT '';
PRINT '  GROUP I: Archive Domain (test-archive-domain.com)';
PRINT '  --------------------------------------------------';
PRINT '  I1: delete_10d (default action)';
PRINT '  I2: keep       (pattern: Legal Notice)';
PRINT '  I3: delete     (pattern: Spam Alert - overrides 10d default)';
PRINT '';
PRINT '================================================================';
PRINT '  TOTAL: 42 test cases (37 original + 5 new for delete_10d)';
PRINT '  VERIFY: Compare actual results above with expected results';
PRINT '================================================================';
GO
