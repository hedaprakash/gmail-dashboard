-- Gmail Criteria Database Schema
-- Run this script to create the database and tables
--
-- Usage:
--   docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
--     -S localhost -U sa -P "MyPass@word123" -C -i /scripts/01-init-schema.sql

-- Create database if not exists
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'GmailCriteria')
BEGIN
    CREATE DATABASE GmailCriteria;
END
GO

USE GmailCriteria;
GO

-- Drop existing tables if recreating
IF OBJECT_ID('email_patterns', 'U') IS NOT NULL DROP TABLE email_patterns;
IF OBJECT_ID('patterns', 'U') IS NOT NULL DROP TABLE patterns;
IF OBJECT_ID('criteria', 'U') IS NOT NULL DROP TABLE criteria;
GO

-- Primary domains, subdomains, and email addresses
CREATE TABLE criteria (
    id INT IDENTITY PRIMARY KEY,
    key_value NVARCHAR(255) NOT NULL UNIQUE,
    key_type NVARCHAR(20) NOT NULL CHECK (key_type IN ('domain', 'subdomain', 'email')),
    default_action NVARCHAR(20) NULL CHECK (default_action IN ('delete', 'delete_1d', 'delete_10d', 'keep') OR default_action IS NULL),
    parent_id INT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (parent_id) REFERENCES criteria(id)
);
GO

-- Subject patterns
CREATE TABLE patterns (
    id INT IDENTITY PRIMARY KEY,
    criteria_id INT NOT NULL,
    action NVARCHAR(20) NOT NULL CHECK (action IN ('keep', 'delete', 'delete_1d', 'delete_10d')),
    pattern NVARCHAR(500) NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (criteria_id) REFERENCES criteria(id) ON DELETE CASCADE
);
GO

-- Email address patterns (fromEmails/toEmails)
CREATE TABLE email_patterns (
    id INT IDENTITY PRIMARY KEY,
    criteria_id INT NOT NULL,
    direction NVARCHAR(10) NOT NULL CHECK (direction IN ('from', 'to')),
    action NVARCHAR(20) NOT NULL CHECK (action IN ('keep', 'delete')),
    email NVARCHAR(255) NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (criteria_id) REFERENCES criteria(id) ON DELETE CASCADE
);
GO

-- Indexes for performance
CREATE INDEX idx_criteria_key_value ON criteria(key_value);
CREATE INDEX idx_criteria_parent_id ON criteria(parent_id);
CREATE INDEX idx_patterns_criteria_id ON patterns(criteria_id);
CREATE INDEX idx_email_patterns_criteria_id ON email_patterns(criteria_id);
GO

PRINT 'Schema created successfully!';
GO
