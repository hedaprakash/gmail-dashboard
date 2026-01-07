/**
 * OAuth Tokens Table
 *
 * Stores OAuth tokens per user for multi-user support.
 * Replaces the single token.json file approach.
 *
 * See ADR-002 for decision rationale.
 *
 * Usage:
 *   docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
 *     -S localhost -U sa -P "MyPass@word123" -C -d GmailCriteria \
 *     -i /tmp/09-create-oauth-tokens-table.sql
 */

USE GmailCriteria;
GO

-- Create oauth_tokens table if it doesn't exist
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'oauth_tokens')
BEGIN
    CREATE TABLE oauth_tokens (
        id INT IDENTITY(1,1) PRIMARY KEY,
        user_email NVARCHAR(255) NOT NULL,
        access_token NVARCHAR(MAX) NOT NULL,
        refresh_token NVARCHAR(MAX) NOT NULL,
        token_expiry DATETIME2 NOT NULL,
        scopes NVARCHAR(MAX) NULL,
        created_at DATETIME2 DEFAULT GETDATE(),
        updated_at DATETIME2 DEFAULT GETDATE(),

        CONSTRAINT UQ_oauth_tokens_user_email UNIQUE (user_email)
    );

    PRINT 'Created oauth_tokens table';
END
ELSE
BEGIN
    PRINT 'oauth_tokens table already exists';
END
GO

-- Create index for faster lookups by email
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_oauth_tokens_user_email')
BEGIN
    CREATE INDEX IX_oauth_tokens_user_email ON oauth_tokens(user_email);
    PRINT 'Created index IX_oauth_tokens_user_email';
END
GO

-- Create stored procedure to upsert tokens
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'UpsertOAuthToken')
    DROP PROCEDURE dbo.UpsertOAuthToken;
GO

CREATE PROCEDURE dbo.UpsertOAuthToken
    @UserEmail NVARCHAR(255),
    @AccessToken NVARCHAR(MAX),
    @RefreshToken NVARCHAR(MAX),
    @TokenExpiry DATETIME2,
    @Scopes NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM oauth_tokens WHERE user_email = @UserEmail)
    BEGIN
        -- Update existing token
        UPDATE oauth_tokens
        SET access_token = @AccessToken,
            refresh_token = @RefreshToken,
            token_expiry = @TokenExpiry,
            scopes = @Scopes,
            updated_at = GETDATE()
        WHERE user_email = @UserEmail;

        PRINT 'Updated token for: ' + @UserEmail;
    END
    ELSE
    BEGIN
        -- Insert new token
        INSERT INTO oauth_tokens (user_email, access_token, refresh_token, token_expiry, scopes)
        VALUES (@UserEmail, @AccessToken, @RefreshToken, @TokenExpiry, @Scopes);

        PRINT 'Inserted token for: ' + @UserEmail;
    END
END;
GO

PRINT 'Created UpsertOAuthToken stored procedure';
GO

-- Create stored procedure to get token by email
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'GetOAuthToken')
    DROP PROCEDURE dbo.GetOAuthToken;
GO

CREATE PROCEDURE dbo.GetOAuthToken
    @UserEmail NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        user_email,
        access_token,
        refresh_token,
        token_expiry,
        scopes,
        created_at,
        updated_at
    FROM oauth_tokens
    WHERE user_email = @UserEmail;
END;
GO

PRINT 'Created GetOAuthToken stored procedure';
GO

-- Create stored procedure to delete token
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'DeleteOAuthToken')
    DROP PROCEDURE dbo.DeleteOAuthToken;
GO

CREATE PROCEDURE dbo.DeleteOAuthToken
    @UserEmail NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM oauth_tokens WHERE user_email = @UserEmail;

    PRINT 'Deleted token for: ' + @UserEmail;
END;
GO

PRINT 'Created DeleteOAuthToken stored procedure';
GO

-- Create stored procedure to get tokens expiring soon (for background refresh)
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'GetExpiringTokens')
    DROP PROCEDURE dbo.GetExpiringTokens;
GO

CREATE PROCEDURE dbo.GetExpiringTokens
    @MinutesBeforeExpiry INT = 15
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        user_email,
        access_token,
        refresh_token,
        token_expiry,
        scopes
    FROM oauth_tokens
    WHERE token_expiry <= DATEADD(MINUTE, @MinutesBeforeExpiry, GETDATE())
    ORDER BY token_expiry ASC;
END;
GO

PRINT 'Created GetExpiringTokens stored procedure';
GO

PRINT '';
PRINT '========================================';
PRINT 'OAuth tokens table setup complete!';
PRINT '========================================';
GO
