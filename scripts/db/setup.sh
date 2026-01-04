#!/bin/bash
# Gmail Criteria Database Setup Script
#
# This script sets up the SQL Server database from scratch.
# Prerequisites: Docker must be running
#
# Usage:
#   ./scripts/db/setup.sh

set -e

# Load environment variables from .env if it exists
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Default values
DB_PASSWORD=${DB_PASSWORD:-MyPass@word123}
DB_NAME=${DB_NAME:-GmailCriteria}
DB_USER=${DB_USER:-sa}

echo "=== Gmail Criteria Database Setup ==="
echo ""

# Check if container is running
if ! docker ps | grep -q gmail-sqlserver; then
    echo "Starting SQL Server container..."
    docker-compose up -d sqlserver
    echo "Waiting for SQL Server to be ready..."
    sleep 30
fi

# Wait for SQL Server to be healthy
echo "Checking SQL Server health..."
for i in {1..30}; do
    if docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U "$DB_USER" -P "$DB_PASSWORD" -C -Q "SELECT 1" > /dev/null 2>&1; then
        echo "SQL Server is ready!"
        break
    fi
    echo "Waiting... ($i/30)"
    sleep 2
done

# Copy scripts to container
echo ""
echo "Copying scripts to container..."
docker cp scripts/db/01-init-schema.sql gmail-sqlserver:/tmp/01-init-schema.sql
docker cp scripts/db/02-migrate-data.sql gmail-sqlserver:/tmp/02-migrate-data.sql
docker cp scripts/db/03-create-evaluate-procedure.sql gmail-sqlserver:/tmp/03-create-evaluate-procedure.sql

# Run schema creation
echo ""
echo "Creating database schema..."
docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U "$DB_USER" -P "$DB_PASSWORD" -C \
    -i /tmp/01-init-schema.sql

# Run data migration
echo ""
echo "Migrating data..."
docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U "$DB_USER" -P "$DB_PASSWORD" -C -d "$DB_NAME" \
    -i /tmp/02-migrate-data.sql > /dev/null

# Create stored procedures
echo ""
echo "Creating stored procedures..."
docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U "$DB_USER" -P "$DB_PASSWORD" -C -d "$DB_NAME" \
    -i /tmp/03-create-evaluate-procedure.sql

# Verify
echo ""
echo "Verifying migration..."
docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U "$DB_USER" -P "$DB_PASSWORD" -C -d "$DB_NAME" \
    -Q "SELECT 'criteria' as tbl, COUNT(*) as cnt FROM criteria UNION ALL SELECT 'patterns', COUNT(*) FROM patterns UNION ALL SELECT 'email_patterns', COUNT(*) FROM email_patterns"

echo ""
echo "=== Setup Complete ==="
