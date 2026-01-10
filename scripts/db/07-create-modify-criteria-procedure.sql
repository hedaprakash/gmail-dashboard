-- ============================================================================
-- ModifyCriteria Stored Procedure
-- ============================================================================
-- Unified stored procedure for all criteria modifications.
-- Supports ADD, REMOVE, UPDATE, CLEAR operations across all dimensions.
-- Includes automatic audit logging for all changes.
--
-- Usage:
--   docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
--     -S localhost -U sa -P "MyPass@word123" -C -d GmailCriteria \
--     -i /scripts/07-create-modify-criteria-procedure.sql
-- ============================================================================

USE GmailCriteria;
GO

-- ============================================================================
-- Step 1: Create audit_log table if not exists
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'audit_log')
BEGIN
    CREATE TABLE audit_log (
        id INT IDENTITY PRIMARY KEY,
        user_email NVARCHAR(255) NOT NULL,
        action_type NVARCHAR(10) NOT NULL,  -- INSERT, UPDATE, DELETE
        table_name NVARCHAR(50) NOT NULL,
        record_id INT NULL,
        domain NVARCHAR(255),
        details NVARCHAR(MAX),  -- JSON
        created_at DATETIME2 DEFAULT GETDATE()
    );
    CREATE INDEX idx_audit_user_email ON audit_log(user_email);
    CREATE INDEX idx_audit_created_at ON audit_log(created_at);
    PRINT 'Created audit_log table';
END
GO

-- ============================================================================
-- Step 2: Create ModifyCriteria stored procedure
-- ============================================================================
IF OBJECT_ID('dbo.ModifyCriteria', 'P') IS NOT NULL
    DROP PROCEDURE dbo.ModifyCriteria;
GO

CREATE PROCEDURE dbo.ModifyCriteria
    @Operation NVARCHAR(10),           -- ADD, REMOVE, UPDATE, CLEAR, GET
    @Dimension NVARCHAR(20),           -- domain, subdomain, email, subject, from_email, to_email
    @Action NVARCHAR(20) = NULL,       -- delete, delete_1d, delete_10d, keep
    @KeyValue NVARCHAR(255) = NULL,    -- The value (domain name, pattern, email address)
    @UserEmail NVARCHAR(255),          -- User's email for multi-user isolation
    @ParentDomain NVARCHAR(255) = NULL,     -- Parent domain (for subdomains/patterns)
    @ParentSubdomain NVARCHAR(255) = NULL,  -- Parent subdomain (for subdomain patterns)
    @OldAction NVARCHAR(20) = NULL     -- For UPDATE: the action being changed from
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Success BIT = 0;
    DECLARE @Message NVARCHAR(500) = '';
    DECLARE @RecordId INT = NULL;
    DECLARE @AuditId INT = NULL;
    DECLARE @ParentCriteriaId INT = NULL;
    DECLARE @SubdomainCriteriaId INT = NULL;
    DECLARE @AffectedRows INT = 0;
    DECLARE @AuditDetails NVARCHAR(MAX);

    -- ====================================================================
    -- Validate @UserEmail is required for multi-user security
    -- ====================================================================
    IF @UserEmail IS NULL OR LTRIM(RTRIM(@UserEmail)) = ''
    BEGIN
        SELECT
            0 AS Success,
            'UserEmail is required. Multi-user isolation requires a valid user email.' AS Message,
            NULL AS RecordId,
            NULL AS AuditId;
        RETURN -1;
    END

    -- Normalize inputs
    SET @Operation = UPPER(@Operation);
    SET @Dimension = LOWER(@Dimension);
    SET @Action = LOWER(@Action);
    SET @KeyValue = LOWER(@KeyValue);
    SET @ParentDomain = LOWER(@ParentDomain);
    SET @ParentSubdomain = LOWER(@ParentSubdomain);
    SET @OldAction = LOWER(@OldAction);

    BEGIN TRY
        BEGIN TRANSACTION;

        -- ====================================================================
        -- DOMAIN Operations
        -- ====================================================================
        IF @Dimension = 'domain'
        BEGIN
            IF @Operation = 'ADD'
            BEGIN
                -- Check if domain already exists for this user
                SELECT @RecordId = id FROM criteria
                WHERE key_value = @KeyValue AND key_type = 'domain' AND user_email = @UserEmail;

                IF @RecordId IS NOT NULL
                BEGIN
                    -- Update existing
                    UPDATE criteria
                    SET default_action = @Action
                    WHERE id = @RecordId;

                    SET @Message = 'Updated ' + @Action + ' rule for domain ' + @KeyValue;
                    SET @AuditDetails = '{"operation":"ADD","dimension":"domain","action":"' + @Action + '","existed":true}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'UPDATE', 'criteria', @RecordId, @KeyValue, @AuditDetails);
                END
                ELSE
                BEGIN
                    -- Insert new
                    INSERT INTO criteria (key_value, key_type, default_action, user_email)
                    VALUES (@KeyValue, 'domain', @Action, @UserEmail);

                    SET @RecordId = SCOPE_IDENTITY();
                    SET @Message = 'Added ' + @Action + ' rule for domain ' + @KeyValue;
                    SET @AuditDetails = '{"operation":"ADD","dimension":"domain","action":"' + @Action + '"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'INSERT', 'criteria', @RecordId, @KeyValue, @AuditDetails);
                END

                SET @AuditId = SCOPE_IDENTITY();
                SET @Success = 1;
            END
            ELSE IF @Operation = 'REMOVE'
            BEGIN
                SELECT @RecordId = id FROM criteria
                WHERE key_value = @KeyValue AND key_type = 'domain' AND user_email = @UserEmail;

                IF @RecordId IS NOT NULL
                BEGIN
                    -- Count children that will be deleted
                    DECLARE @SubdomainCount INT, @PatternCount INT, @EmailPatternCount INT;

                    SELECT @SubdomainCount = COUNT(*) FROM criteria WHERE parent_id = @RecordId;
                    SELECT @PatternCount = COUNT(*) FROM patterns WHERE criteria_id = @RecordId;
                    SELECT @EmailPatternCount = COUNT(*) FROM email_patterns WHERE criteria_id = @RecordId;

                    -- Delete domain (cascades to patterns and email_patterns due to FK)
                    -- First delete subdomains
                    DELETE FROM criteria WHERE parent_id = @RecordId;
                    DELETE FROM criteria WHERE id = @RecordId;

                    SET @Message = 'Removed domain ' + @KeyValue + ' and ' +
                        CAST(@SubdomainCount AS NVARCHAR) + ' subdomains, ' +
                        CAST(@PatternCount AS NVARCHAR) + ' patterns';
                    SET @AuditDetails = '{"operation":"REMOVE","dimension":"domain","subdomains":' +
                        CAST(@SubdomainCount AS NVARCHAR) + ',"patterns":' +
                        CAST(@PatternCount AS NVARCHAR) + '}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'DELETE', 'criteria', @RecordId, @KeyValue, @AuditDetails);

                    SET @AuditId = SCOPE_IDENTITY();
                    SET @RecordId = NULL;  -- Record no longer exists
                    SET @Success = 1;
                END
                ELSE
                BEGIN
                    SET @Message = 'Domain ' + @KeyValue + ' not found';
                    SET @Success = 1;  -- Not an error, just nothing to remove
                END
            END
            ELSE IF @Operation = 'UPDATE'
            BEGIN
                SELECT @RecordId = id FROM criteria
                WHERE key_value = @KeyValue AND key_type = 'domain' AND user_email = @UserEmail;

                IF @RecordId IS NOT NULL
                BEGIN
                    DECLARE @CurrentAction NVARCHAR(20);
                    SELECT @CurrentAction = default_action FROM criteria WHERE id = @RecordId;

                    UPDATE criteria
                    SET default_action = @Action
                    WHERE id = @RecordId;

                    SET @Message = 'Updated domain ' + @KeyValue + ' from ' + ISNULL(@CurrentAction, 'null') + ' to ' + @Action;
                    SET @AuditDetails = '{"operation":"UPDATE","dimension":"domain","old_action":"' +
                        ISNULL(@CurrentAction, 'null') + '","new_action":"' + @Action + '"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'UPDATE', 'criteria', @RecordId, @KeyValue, @AuditDetails);

                    SET @AuditId = SCOPE_IDENTITY();
                    SET @Success = 1;
                END
                ELSE
                BEGIN
                    SET @Message = 'Domain ' + @KeyValue + ' not found';
                    SET @Success = 0;
                END
            END
            ELSE IF @Operation = 'CLEAR'
            BEGIN
                -- Same as REMOVE for domain
                SELECT @RecordId = id FROM criteria
                WHERE key_value = @KeyValue AND key_type = 'domain' AND user_email = @UserEmail;

                IF @RecordId IS NOT NULL
                BEGIN
                    DELETE FROM criteria WHERE parent_id = @RecordId;
                    DELETE FROM criteria WHERE id = @RecordId;

                    SET @Message = 'Cleared all rules for domain ' + @KeyValue;
                    SET @AuditDetails = '{"operation":"CLEAR","dimension":"domain"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'DELETE', 'criteria', @RecordId, @KeyValue, @AuditDetails);

                    SET @AuditId = SCOPE_IDENTITY();
                    SET @RecordId = NULL;
                    SET @Success = 1;
                END
                ELSE
                BEGIN
                    SET @Message = 'Domain ' + @KeyValue + ' not found';
                    SET @Success = 1;
                END
            END
            ELSE IF @Operation = 'GET'
            BEGIN
                -- Return domain info - handled separately below
                SET @Success = 1;
                SET @Message = 'Query completed';
            END
        END

        -- ====================================================================
        -- SUBDOMAIN Operations
        -- ====================================================================
        ELSE IF @Dimension = 'subdomain'
        BEGIN
            -- Find parent domain first
            SELECT @ParentCriteriaId = id FROM criteria
            WHERE key_value = @ParentDomain AND key_type = 'domain' AND user_email = @UserEmail;

            IF @ParentCriteriaId IS NULL AND @Operation != 'GET'
            BEGIN
                -- Create parent domain if it doesn't exist (for ADD only)
                IF @Operation = 'ADD'
                BEGIN
                    INSERT INTO criteria (key_value, key_type, default_action, user_email)
                    VALUES (@ParentDomain, 'domain', NULL, @UserEmail);
                    SET @ParentCriteriaId = SCOPE_IDENTITY();

                    -- Log domain creation
                    SET @AuditDetails = '{"operation":"ADD","dimension":"domain","action":null,"auto_created":true}';
                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'INSERT', 'criteria', @ParentCriteriaId, @ParentDomain, @AuditDetails);
                END
                ELSE
                BEGIN
                    SET @Message = 'Parent domain ' + @ParentDomain + ' not found';
                    SET @Success = 0;
                    GOTO EndProc;
                END
            END

            IF @Operation = 'ADD'
            BEGIN
                -- Check if subdomain already exists
                SELECT @RecordId = id FROM criteria
                WHERE key_value = @KeyValue AND key_type = 'subdomain'
                AND parent_id = @ParentCriteriaId AND user_email = @UserEmail;

                IF @RecordId IS NOT NULL
                BEGIN
                    UPDATE criteria
                    SET default_action = @Action
                    WHERE id = @RecordId;

                    SET @Message = 'Updated ' + @Action + ' rule for subdomain ' + @KeyValue + '.' + @ParentDomain;
                    SET @AuditDetails = '{"operation":"ADD","dimension":"subdomain","action":"' + @Action + '","existed":true}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'UPDATE', 'criteria', @RecordId, @ParentDomain, @AuditDetails);
                END
                ELSE
                BEGIN
                    INSERT INTO criteria (key_value, key_type, default_action, parent_id, user_email)
                    VALUES (@KeyValue, 'subdomain', @Action, @ParentCriteriaId, @UserEmail);

                    SET @RecordId = SCOPE_IDENTITY();
                    SET @Message = 'Added ' + @Action + ' rule for subdomain ' + @KeyValue + '.' + @ParentDomain;
                    SET @AuditDetails = '{"operation":"ADD","dimension":"subdomain","action":"' + @Action + '","subdomain":"' + @KeyValue + '"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'INSERT', 'criteria', @RecordId, @ParentDomain, @AuditDetails);
                END

                SET @AuditId = SCOPE_IDENTITY();
                SET @Success = 1;
            END
            ELSE IF @Operation = 'REMOVE'
            BEGIN
                SELECT @RecordId = id FROM criteria
                WHERE key_value = @KeyValue AND key_type = 'subdomain'
                AND parent_id = @ParentCriteriaId AND user_email = @UserEmail;

                IF @RecordId IS NOT NULL
                BEGIN
                    -- Patterns/email_patterns will cascade delete
                    DELETE FROM criteria WHERE id = @RecordId;

                    SET @Message = 'Removed subdomain ' + @KeyValue + '.' + @ParentDomain;
                    SET @AuditDetails = '{"operation":"REMOVE","dimension":"subdomain","subdomain":"' + @KeyValue + '"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'DELETE', 'criteria', @RecordId, @ParentDomain, @AuditDetails);

                    SET @AuditId = SCOPE_IDENTITY();
                    SET @RecordId = NULL;
                    SET @Success = 1;
                END
                ELSE
                BEGIN
                    SET @Message = 'Subdomain ' + @KeyValue + '.' + @ParentDomain + ' not found';
                    SET @Success = 1;
                END
            END
            ELSE IF @Operation = 'UPDATE'
            BEGIN
                SELECT @RecordId = id FROM criteria
                WHERE key_value = @KeyValue AND key_type = 'subdomain'
                AND parent_id = @ParentCriteriaId AND user_email = @UserEmail;

                IF @RecordId IS NOT NULL
                BEGIN
                    DECLARE @CurrentSubAction NVARCHAR(20);
                    SELECT @CurrentSubAction = default_action FROM criteria WHERE id = @RecordId;

                    UPDATE criteria
                    SET default_action = @Action
                    WHERE id = @RecordId;

                    SET @Message = 'Updated subdomain ' + @KeyValue + '.' + @ParentDomain + ' from ' + ISNULL(@CurrentSubAction, 'null') + ' to ' + @Action;
                    SET @AuditDetails = '{"operation":"UPDATE","dimension":"subdomain","subdomain":"' + @KeyValue +
                        '","old_action":"' + ISNULL(@CurrentSubAction, 'null') + '","new_action":"' + @Action + '"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'UPDATE', 'criteria', @RecordId, @ParentDomain, @AuditDetails);

                    SET @AuditId = SCOPE_IDENTITY();
                    SET @Success = 1;
                END
                ELSE
                BEGIN
                    SET @Message = 'Subdomain ' + @KeyValue + '.' + @ParentDomain + ' not found';
                    SET @Success = 0;
                END
            END
            ELSE IF @Operation = 'GET'
            BEGIN
                SET @Success = 1;
                SET @Message = 'Query completed';
            END
        END

        -- ====================================================================
        -- SUBJECT Pattern Operations
        -- ====================================================================
        ELSE IF @Dimension = 'subject'
        BEGIN
            -- Find the criteria to attach the pattern to
            IF @ParentSubdomain IS NOT NULL AND @ParentSubdomain != ''
            BEGIN
                -- Pattern for subdomain
                SELECT @ParentCriteriaId = id FROM criteria
                WHERE key_value = @ParentDomain AND key_type = 'domain' AND user_email = @UserEmail;

                IF @ParentCriteriaId IS NOT NULL
                BEGIN
                    SELECT @SubdomainCriteriaId = id FROM criteria
                    WHERE key_value = @ParentSubdomain AND key_type = 'subdomain'
                    AND parent_id = @ParentCriteriaId AND user_email = @UserEmail;
                END

                SET @ParentCriteriaId = @SubdomainCriteriaId;
            END
            ELSE
            BEGIN
                -- Pattern for domain
                SELECT @ParentCriteriaId = id FROM criteria
                WHERE key_value = @ParentDomain AND key_type = 'domain' AND user_email = @UserEmail;
            END

            IF @ParentCriteriaId IS NULL AND @Operation != 'GET'
            BEGIN
                IF @Operation = 'ADD'
                BEGIN
                    -- Auto-create domain
                    INSERT INTO criteria (key_value, key_type, default_action, user_email)
                    VALUES (@ParentDomain, 'domain', NULL, @UserEmail);
                    SET @ParentCriteriaId = SCOPE_IDENTITY();

                    SET @AuditDetails = '{"operation":"ADD","dimension":"domain","action":null,"auto_created":true}';
                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'INSERT', 'criteria', @ParentCriteriaId, @ParentDomain, @AuditDetails);
                END
                ELSE
                BEGIN
                    SET @Message = 'Parent domain/subdomain not found';
                    SET @Success = 0;
                    GOTO EndProc;
                END
            END

            IF @Operation = 'ADD'
            BEGIN
                -- Check if pattern already exists
                SELECT @RecordId = id FROM patterns
                WHERE criteria_id = @ParentCriteriaId AND pattern = @KeyValue AND action = @Action;

                IF @RecordId IS NOT NULL
                BEGIN
                    SET @Message = 'Pattern ''' + @KeyValue + ''' already exists for ' + @Action;
                    SET @Success = 1;  -- Idempotent
                END
                ELSE
                BEGIN
                    INSERT INTO patterns (criteria_id, action, pattern)
                    VALUES (@ParentCriteriaId, @Action, @KeyValue);

                    SET @RecordId = SCOPE_IDENTITY();
                    SET @Message = 'Added ' + @Action + ' pattern ''' + @KeyValue + ''' for ' + @ParentDomain;
                    SET @AuditDetails = '{"operation":"ADD","dimension":"subject","action":"' + @Action + '","pattern":"' + @KeyValue + '"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'INSERT', 'patterns', @RecordId, @ParentDomain, @AuditDetails);

                    SET @AuditId = SCOPE_IDENTITY();
                END
                SET @Success = 1;
            END
            ELSE IF @Operation = 'REMOVE'
            BEGIN
                -- Remove pattern (optionally filtered by action)
                IF @Action IS NOT NULL
                BEGIN
                    DELETE FROM patterns
                    WHERE criteria_id = @ParentCriteriaId AND pattern = @KeyValue AND action = @Action;
                END
                ELSE
                BEGIN
                    DELETE FROM patterns
                    WHERE criteria_id = @ParentCriteriaId AND pattern = @KeyValue;
                END

                SET @AffectedRows = @@ROWCOUNT;

                IF @AffectedRows > 0
                BEGIN
                    SET @Message = 'Removed ' + CAST(@AffectedRows AS NVARCHAR) + ' pattern(s) ''' + @KeyValue + '''';
                    SET @AuditDetails = '{"operation":"REMOVE","dimension":"subject","pattern":"' + @KeyValue + '","count":' + CAST(@AffectedRows AS NVARCHAR) + '}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'DELETE', 'patterns', NULL, @ParentDomain, @AuditDetails);

                    SET @AuditId = SCOPE_IDENTITY();
                END
                ELSE
                BEGIN
                    SET @Message = 'Pattern ''' + @KeyValue + ''' not found';
                END
                SET @Success = 1;
            END
            ELSE IF @Operation = 'UPDATE'
            BEGIN
                SELECT @RecordId = id FROM patterns
                WHERE criteria_id = @ParentCriteriaId AND pattern = @KeyValue AND action = @OldAction;

                IF @RecordId IS NOT NULL
                BEGIN
                    UPDATE patterns SET action = @Action WHERE id = @RecordId;

                    SET @Message = 'Updated pattern ''' + @KeyValue + ''' from ' + @OldAction + ' to ' + @Action;
                    SET @AuditDetails = '{"operation":"UPDATE","dimension":"subject","pattern":"' + @KeyValue +
                        '","old_action":"' + @OldAction + '","new_action":"' + @Action + '"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'UPDATE', 'patterns', @RecordId, @ParentDomain, @AuditDetails);

                    SET @AuditId = SCOPE_IDENTITY();
                    SET @Success = 1;
                END
                ELSE
                BEGIN
                    SET @Message = 'Pattern ''' + @KeyValue + ''' with action ' + @OldAction + ' not found';
                    SET @Success = 0;
                END
            END
            ELSE IF @Operation = 'GET'
            BEGIN
                SET @Success = 1;
                SET @Message = 'Query completed';
            END
        END

        -- ====================================================================
        -- FROM_EMAIL Operations
        -- ====================================================================
        ELSE IF @Dimension = 'from_email'
        BEGIN
            -- Find parent criteria
            SELECT @ParentCriteriaId = id FROM criteria
            WHERE key_value = @ParentDomain AND key_type = 'domain' AND user_email = @UserEmail;

            IF @ParentCriteriaId IS NULL AND @Operation != 'GET'
            BEGIN
                IF @Operation = 'ADD'
                BEGIN
                    INSERT INTO criteria (key_value, key_type, default_action, user_email)
                    VALUES (@ParentDomain, 'domain', NULL, @UserEmail);
                    SET @ParentCriteriaId = SCOPE_IDENTITY();

                    SET @AuditDetails = '{"operation":"ADD","dimension":"domain","action":null,"auto_created":true}';
                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'INSERT', 'criteria', @ParentCriteriaId, @ParentDomain, @AuditDetails);
                END
                ELSE
                BEGIN
                    SET @Message = 'Parent domain ' + @ParentDomain + ' not found';
                    SET @Success = 0;
                    GOTO EndProc;
                END
            END

            IF @Operation = 'ADD'
            BEGIN
                -- Check if already exists
                SELECT @RecordId = id FROM email_patterns
                WHERE criteria_id = @ParentCriteriaId AND direction = 'from' AND email = @KeyValue;

                IF @RecordId IS NOT NULL
                BEGIN
                    -- Update existing
                    UPDATE email_patterns SET action = @Action WHERE id = @RecordId;
                    SET @Message = 'Updated from_email rule for ' + @KeyValue + ' to ' + @Action;

                    SET @AuditDetails = '{"operation":"ADD","dimension":"from_email","action":"' + @Action + '","email":"' + @KeyValue + '","existed":true}';
                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'UPDATE', 'email_patterns', @RecordId, @ParentDomain, @AuditDetails);
                END
                ELSE
                BEGIN
                    INSERT INTO email_patterns (criteria_id, direction, action, email)
                    VALUES (@ParentCriteriaId, 'from', @Action, @KeyValue);

                    SET @RecordId = SCOPE_IDENTITY();
                    SET @Message = 'Added ' + @Action + ' rule for emails from ' + @KeyValue;

                    SET @AuditDetails = '{"operation":"ADD","dimension":"from_email","action":"' + @Action + '","email":"' + @KeyValue + '"}';
                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'INSERT', 'email_patterns', @RecordId, @ParentDomain, @AuditDetails);
                END

                SET @AuditId = SCOPE_IDENTITY();
                SET @Success = 1;
            END
            ELSE IF @Operation = 'REMOVE'
            BEGIN
                DELETE FROM email_patterns
                WHERE criteria_id = @ParentCriteriaId AND direction = 'from' AND email = @KeyValue;

                SET @AffectedRows = @@ROWCOUNT;

                IF @AffectedRows > 0
                BEGIN
                    SET @Message = 'Removed from_email rule for ' + @KeyValue;
                    SET @AuditDetails = '{"operation":"REMOVE","dimension":"from_email","email":"' + @KeyValue + '"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'DELETE', 'email_patterns', NULL, @ParentDomain, @AuditDetails);

                    SET @AuditId = SCOPE_IDENTITY();
                END
                ELSE
                BEGIN
                    SET @Message = 'From_email rule for ' + @KeyValue + ' not found';
                END
                SET @Success = 1;
            END
            ELSE IF @Operation = 'UPDATE'
            BEGIN
                SELECT @RecordId = id FROM email_patterns
                WHERE criteria_id = @ParentCriteriaId AND direction = 'from' AND email = @KeyValue;

                IF @RecordId IS NOT NULL
                BEGIN
                    DECLARE @CurrentFromAction NVARCHAR(20);
                    SELECT @CurrentFromAction = action FROM email_patterns WHERE id = @RecordId;

                    UPDATE email_patterns SET action = @Action WHERE id = @RecordId;

                    SET @Message = 'Updated from_email ' + @KeyValue + ' from ' + @CurrentFromAction + ' to ' + @Action;
                    SET @AuditDetails = '{"operation":"UPDATE","dimension":"from_email","email":"' + @KeyValue +
                        '","old_action":"' + @CurrentFromAction + '","new_action":"' + @Action + '"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'UPDATE', 'email_patterns', @RecordId, @ParentDomain, @AuditDetails);

                    SET @AuditId = SCOPE_IDENTITY();
                    SET @Success = 1;
                END
                ELSE
                BEGIN
                    SET @Message = 'From_email rule for ' + @KeyValue + ' not found';
                    SET @Success = 0;
                END
            END
            ELSE IF @Operation = 'GET'
            BEGIN
                SET @Success = 1;
                SET @Message = 'Query completed';
            END
        END

        -- ====================================================================
        -- TO_EMAIL Operations
        -- ====================================================================
        ELSE IF @Dimension = 'to_email'
        BEGIN
            -- Find parent criteria
            SELECT @ParentCriteriaId = id FROM criteria
            WHERE key_value = @ParentDomain AND key_type = 'domain' AND user_email = @UserEmail;

            IF @ParentCriteriaId IS NULL AND @Operation != 'GET'
            BEGIN
                IF @Operation = 'ADD'
                BEGIN
                    INSERT INTO criteria (key_value, key_type, default_action, user_email)
                    VALUES (@ParentDomain, 'domain', NULL, @UserEmail);
                    SET @ParentCriteriaId = SCOPE_IDENTITY();

                    SET @AuditDetails = '{"operation":"ADD","dimension":"domain","action":null,"auto_created":true}';
                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'INSERT', 'criteria', @ParentCriteriaId, @ParentDomain, @AuditDetails);
                END
                ELSE
                BEGIN
                    SET @Message = 'Parent domain ' + @ParentDomain + ' not found';
                    SET @Success = 0;
                    GOTO EndProc;
                END
            END

            IF @Operation = 'ADD'
            BEGIN
                SELECT @RecordId = id FROM email_patterns
                WHERE criteria_id = @ParentCriteriaId AND direction = 'to' AND email = @KeyValue;

                IF @RecordId IS NOT NULL
                BEGIN
                    UPDATE email_patterns SET action = @Action WHERE id = @RecordId;
                    SET @Message = 'Updated to_email rule for ' + @KeyValue + ' to ' + @Action;

                    SET @AuditDetails = '{"operation":"ADD","dimension":"to_email","action":"' + @Action + '","email":"' + @KeyValue + '","existed":true}';
                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'UPDATE', 'email_patterns', @RecordId, @ParentDomain, @AuditDetails);
                END
                ELSE
                BEGIN
                    INSERT INTO email_patterns (criteria_id, direction, action, email)
                    VALUES (@ParentCriteriaId, 'to', @Action, @KeyValue);

                    SET @RecordId = SCOPE_IDENTITY();
                    SET @Message = 'Added ' + @Action + ' rule for emails to ' + @KeyValue;

                    SET @AuditDetails = '{"operation":"ADD","dimension":"to_email","action":"' + @Action + '","email":"' + @KeyValue + '"}';
                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'INSERT', 'email_patterns', @RecordId, @ParentDomain, @AuditDetails);
                END

                SET @AuditId = SCOPE_IDENTITY();
                SET @Success = 1;
            END
            ELSE IF @Operation = 'REMOVE'
            BEGIN
                DELETE FROM email_patterns
                WHERE criteria_id = @ParentCriteriaId AND direction = 'to' AND email = @KeyValue;

                SET @AffectedRows = @@ROWCOUNT;

                IF @AffectedRows > 0
                BEGIN
                    SET @Message = 'Removed to_email rule for ' + @KeyValue;
                    SET @AuditDetails = '{"operation":"REMOVE","dimension":"to_email","email":"' + @KeyValue + '"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'DELETE', 'email_patterns', NULL, @ParentDomain, @AuditDetails);

                    SET @AuditId = SCOPE_IDENTITY();
                END
                ELSE
                BEGIN
                    SET @Message = 'To_email rule for ' + @KeyValue + ' not found';
                END
                SET @Success = 1;
            END
            ELSE IF @Operation = 'UPDATE'
            BEGIN
                SELECT @RecordId = id FROM email_patterns
                WHERE criteria_id = @ParentCriteriaId AND direction = 'to' AND email = @KeyValue;

                IF @RecordId IS NOT NULL
                BEGIN
                    DECLARE @CurrentToAction NVARCHAR(20);
                    SELECT @CurrentToAction = action FROM email_patterns WHERE id = @RecordId;

                    UPDATE email_patterns SET action = @Action WHERE id = @RecordId;

                    SET @Message = 'Updated to_email ' + @KeyValue + ' from ' + @CurrentToAction + ' to ' + @Action;
                    SET @AuditDetails = '{"operation":"UPDATE","dimension":"to_email","email":"' + @KeyValue +
                        '","old_action":"' + @CurrentToAction + '","new_action":"' + @Action + '"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'UPDATE', 'email_patterns', @RecordId, @ParentDomain, @AuditDetails);

                    SET @AuditId = SCOPE_IDENTITY();
                    SET @Success = 1;
                END
                ELSE
                BEGIN
                    SET @Message = 'To_email rule for ' + @KeyValue + ' not found';
                    SET @Success = 0;
                END
            END
            ELSE IF @Operation = 'GET'
            BEGIN
                SET @Success = 1;
                SET @Message = 'Query completed';
            END
        END

        -- ====================================================================
        -- EMAIL (top-level key) Operations
        -- ====================================================================
        ELSE IF @Dimension = 'email'
        BEGIN
            IF @Operation = 'ADD'
            BEGIN
                SELECT @RecordId = id FROM criteria
                WHERE key_value = @KeyValue AND key_type = 'email' AND user_email = @UserEmail;

                IF @RecordId IS NOT NULL
                BEGIN
                    UPDATE criteria
                    SET default_action = @Action
                    WHERE id = @RecordId;

                    SET @Message = 'Updated ' + @Action + ' rule for email ' + @KeyValue;
                    SET @AuditDetails = '{"operation":"ADD","dimension":"email","action":"' + @Action + '","existed":true}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'UPDATE', 'criteria', @RecordId, @KeyValue, @AuditDetails);
                END
                ELSE
                BEGIN
                    INSERT INTO criteria (key_value, key_type, default_action, user_email)
                    VALUES (@KeyValue, 'email', @Action, @UserEmail);

                    SET @RecordId = SCOPE_IDENTITY();
                    SET @Message = 'Added ' + @Action + ' rule for email ' + @KeyValue;
                    SET @AuditDetails = '{"operation":"ADD","dimension":"email","action":"' + @Action + '"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'INSERT', 'criteria', @RecordId, @KeyValue, @AuditDetails);
                END

                SET @AuditId = SCOPE_IDENTITY();
                SET @Success = 1;
            END
            ELSE IF @Operation = 'REMOVE'
            BEGIN
                SELECT @RecordId = id FROM criteria
                WHERE key_value = @KeyValue AND key_type = 'email' AND user_email = @UserEmail;

                IF @RecordId IS NOT NULL
                BEGIN
                    DELETE FROM criteria WHERE id = @RecordId;

                    SET @Message = 'Removed email ' + @KeyValue;
                    SET @AuditDetails = '{"operation":"REMOVE","dimension":"email"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'DELETE', 'criteria', @RecordId, @KeyValue, @AuditDetails);

                    SET @AuditId = SCOPE_IDENTITY();
                    SET @RecordId = NULL;
                    SET @Success = 1;
                END
                ELSE
                BEGIN
                    SET @Message = 'Email ' + @KeyValue + ' not found';
                    SET @Success = 1;
                END
            END
            ELSE IF @Operation = 'UPDATE'
            BEGIN
                SELECT @RecordId = id FROM criteria
                WHERE key_value = @KeyValue AND key_type = 'email' AND user_email = @UserEmail;

                IF @RecordId IS NOT NULL
                BEGIN
                    DECLARE @CurrentEmailAction NVARCHAR(20);
                    SELECT @CurrentEmailAction = default_action FROM criteria WHERE id = @RecordId;

                    UPDATE criteria
                    SET default_action = @Action
                    WHERE id = @RecordId;

                    SET @Message = 'Updated email ' + @KeyValue + ' from ' + ISNULL(@CurrentEmailAction, 'null') + ' to ' + @Action;
                    SET @AuditDetails = '{"operation":"UPDATE","dimension":"email","old_action":"' +
                        ISNULL(@CurrentEmailAction, 'null') + '","new_action":"' + @Action + '"}';

                    INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
                    VALUES (@UserEmail, 'UPDATE', 'criteria', @RecordId, @KeyValue, @AuditDetails);

                    SET @AuditId = SCOPE_IDENTITY();
                    SET @Success = 1;
                END
                ELSE
                BEGIN
                    SET @Message = 'Email ' + @KeyValue + ' not found';
                    SET @Success = 0;
                END
            END
            ELSE IF @Operation = 'GET'
            BEGIN
                SET @Success = 1;
                SET @Message = 'Query completed';
            END
        END
        ELSE
        BEGIN
            SET @Message = 'Unknown dimension: ' + @Dimension;
            SET @Success = 0;
        END

EndProc:
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        SET @Success = 0;
        SET @Message = ERROR_MESSAGE();

        -- Log error
        INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
        VALUES (@UserEmail, 'ERROR', 'ModifyCriteria', NULL, @ParentDomain,
            '{"error":"' + REPLACE(ERROR_MESSAGE(), '"', '\"') + '","operation":"' + @Operation + '","dimension":"' + @Dimension + '"}');
    END CATCH

    -- Return result
    SELECT
        @Success AS Success,
        @Message AS Message,
        @RecordId AS RecordId,
        @AuditId AS AuditId;

    -- For GET operations, return additional data
    IF @Operation = 'GET' AND @Success = 1
    BEGIN
        IF @Dimension = 'domain'
        BEGIN
            -- Return domain with subdomains and patterns
            SELECT
                c.id,
                c.key_value,
                c.key_type,
                c.default_action,
                (SELECT COUNT(*) FROM criteria sub WHERE sub.parent_id = c.id) AS subdomain_count,
                (SELECT COUNT(*) FROM patterns p WHERE p.criteria_id = c.id) AS pattern_count,
                (SELECT COUNT(*) FROM email_patterns ep WHERE ep.criteria_id = c.id) AS email_pattern_count
            FROM criteria c
            WHERE c.key_value = @KeyValue AND c.key_type = 'domain' AND c.user_email = @UserEmail;
        END
        ELSE IF @Dimension = 'subdomain'
        BEGIN
            IF @KeyValue IS NULL
            BEGIN
                -- List all subdomains for domain
                SELECT
                    c.id,
                    c.key_value AS subdomain,
                    c.default_action AS action,
                    (SELECT COUNT(*) FROM patterns p WHERE p.criteria_id = c.id) AS pattern_count
                FROM criteria c
                WHERE c.parent_id = @ParentCriteriaId AND c.key_type = 'subdomain';
            END
            ELSE
            BEGIN
                -- Get specific subdomain with patterns
                SELECT
                    c.id,
                    c.key_value AS subdomain,
                    c.default_action AS action
                FROM criteria c
                WHERE c.key_value = @KeyValue AND c.parent_id = @ParentCriteriaId AND c.key_type = 'subdomain';

                -- Also return patterns
                SELECT p.id, p.action, p.pattern
                FROM patterns p
                INNER JOIN criteria c ON p.criteria_id = c.id
                WHERE c.key_value = @KeyValue AND c.parent_id = @ParentCriteriaId AND c.key_type = 'subdomain';
            END
        END
    END
END;
GO

PRINT 'Created ModifyCriteria stored procedure';
GO

PRINT '============================================================================';
PRINT 'ModifyCriteria stored procedure created successfully!';
PRINT '============================================================================';
GO
