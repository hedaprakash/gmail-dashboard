# Gmail Dashboard - Startup Script
# Usage: .\start.ps1

param(
    [switch]$SkipChecks,
    [switch]$SkipDocker,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# Colors for output
function Write-Success { param($msg) Write-Host $msg -ForegroundColor Green }
function Write-Info { param($msg) Write-Host $msg -ForegroundColor Cyan }
function Write-Warn { param($msg) Write-Host $msg -ForegroundColor Yellow }
function Write-Err { param($msg) Write-Host $msg -ForegroundColor Red }

function Show-Help {
    Write-Host ""
    Write-Host "Gmail Dashboard - Startup Script" -ForegroundColor Cyan
    Write-Host "=================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Usage: .\start.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -SkipChecks    Skip all environment and database checks"
    Write-Host "  -SkipDocker    Skip Docker/SQL Server check (if using external DB)"
    Write-Host "  -Help          Show this help message"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  .\start.ps1              # Run with all checks"
    Write-Host "  .\start.ps1 -SkipChecks  # Quick start, skip all checks"
    Write-Host "  .\start.ps1 -SkipDocker  # Skip Docker check only"
    Write-Host ""
    Write-Host "URLs:"
    Write-Host "  Frontend:  http://localhost:3000"
    Write-Host "  Backend:   http://localhost:5000"
    Write-Host "  API Health: http://localhost:5000/api/health"
    Write-Host ""
}

function Test-Credentials {
    $credPath = Join-Path $ProjectRoot "data\credentials.json"
    $credExamplePath = Join-Path $ProjectRoot "data\credentials.example.json"

    if (-not (Test-Path $credPath)) {
        Write-Err "ERROR: data\credentials.json not found!"
        Write-Host ""
        Write-Info "To set up Google OAuth credentials:"
        Write-Host "  1. Go to https://console.cloud.google.com/"
        Write-Host "  2. Create a project and enable Gmail API + People API"
        Write-Host "  3. Create OAuth 2.0 credentials (Desktop app)"
        Write-Host "  4. Download and save as data\credentials.json"
        Write-Host ""

        if (Test-Path $credExamplePath) {
            Write-Info "See data\credentials.example.json for the expected format."
        }
        return $false
    }
    return $true
}

function Test-EnvFile {
    $envPath = Join-Path $ProjectRoot ".env"
    $envExamplePath = Join-Path $ProjectRoot ".env.example"

    if (-not (Test-Path $envPath)) {
        Write-Warn "WARNING: .env file not found"

        if (Test-Path $envExamplePath) {
            Write-Info "Creating .env from .env.example..."
            Copy-Item $envExamplePath $envPath
            Write-Success "  Created .env file"
        } else {
            Write-Info "Creating default .env file..."
            @"
# SQL Server connection
DB_USER=sa
DB_PASSWORD=MyPass@word123
DB_SERVER=localhost
DB_DATABASE=GmailCriteria
DB_PORT=1433

# Enable SQL database
USE_SQL_DATABASE=true

# Session secret (change in production!)
SESSION_SECRET=gmail-dashboard-secret-key-change-in-production
"@ | Set-Content $envPath
            Write-Success "  Created default .env file"
        }
    }
    return $true
}

function Test-Dependencies {
    $nodeModulesPath = Join-Path $ProjectRoot "node_modules"

    if (-not (Test-Path $nodeModulesPath)) {
        Write-Warn "node_modules not found. Installing dependencies..."
        Push-Location $ProjectRoot
        npm install
        Pop-Location
    }
    return $true
}

function Test-DockerSqlServer {
    Write-Info "Checking SQL Server Docker container..."

    try {
        # Check if Docker is available
        $dockerVersion = docker --version 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "  Docker not found or not running"
            Write-Host "  SQL Server features will not work without Docker"
            return $false
        }

        # Check if gmail-sqlserver container exists and is running
        $containerStatus = docker ps --filter "name=gmail-sqlserver" --format "{{.Status}}" 2>&1

        if ($containerStatus -match "Up") {
            Write-Success "  SQL Server container: Running"
            return $true
        }

        # Check if container exists but is stopped
        $containerExists = docker ps -a --filter "name=gmail-sqlserver" --format "{{.Names}}" 2>&1
        if ($containerExists -match "gmail-sqlserver") {
            Write-Warn "  SQL Server container exists but is stopped"
            Write-Info "  Starting container..."
            docker start gmail-sqlserver
            Start-Sleep -Seconds 3
            Write-Success "  SQL Server container: Started"
            return $true
        }

        # Container doesn't exist, start with docker-compose
        $composePath = Join-Path $ProjectRoot "docker-compose.yml"
        if (Test-Path $composePath) {
            Write-Warn "  SQL Server container not found"
            Write-Info "  Starting with docker-compose..."
            Push-Location $ProjectRoot
            docker-compose up -d
            Pop-Location
            Write-Info "  Waiting for SQL Server to be ready..."
            Start-Sleep -Seconds 10
            Write-Success "  SQL Server container: Started"
            return $true
        } else {
            Write-Warn "  docker-compose.yml not found"
            Write-Host "  Cannot start SQL Server automatically"
            return $false
        }
    } catch {
        Write-Warn "  Error checking Docker: $_"
        return $false
    }
}

function Test-DatabaseConnection {
    Write-Info "Testing database connection..."

    try {
        # Use docker exec to test SQL Server connection directly
        $result = docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "MyPass@word123" -C -Q "SELECT 1" 2>&1

        if ($LASTEXITCODE -eq 0) {
            Write-Success "  Database connection: OK"
            return $true
        } else {
            Write-Warn "  Database connection: FAILED"
            return $false
        }
    } catch {
        Write-Warn "  Database test skipped (docker exec failed)"
        return $false
    }
}

function Start-Servers {
    Write-Host ""
    Write-Success "Starting Gmail Dashboard..."
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Info "Frontend:   http://localhost:3000"
    Write-Info "Backend:    http://localhost:5000"
    Write-Info "API Health: http://localhost:5000/api/health"
    Write-Host ""
    Write-Info "Press Ctrl+C to stop"
    Write-Host ""

    Push-Location $ProjectRoot
    npm run dev
    Pop-Location
}

# Main execution
Write-Host ""
Write-Host "Gmail Dashboard" -ForegroundColor Cyan
Write-Host "===============" -ForegroundColor Cyan
Write-Host ""

if ($Help) {
    Show-Help
    exit 0
}

Set-Location $ProjectRoot

if (-not $SkipChecks) {
    # Check 1: Google OAuth credentials
    Write-Info "Checking credentials..."
    if (-not (Test-Credentials)) {
        Write-Warn "  Continuing without credentials (OAuth login will fail)"
    } else {
        Write-Success "  Credentials file: OK"
    }

    # Check 2: .env file
    Write-Info "Checking environment..."
    if (-not (Test-EnvFile)) {
        exit 1
    }
    Write-Success "  Environment file: OK"

    # Check 3: Dependencies
    Write-Info "Checking dependencies..."
    if (-not (Test-Dependencies)) {
        exit 1
    }
    Write-Success "  Dependencies: OK"

    # Check 4: Docker/SQL Server
    if (-not $SkipDocker) {
        if (-not (Test-DockerSqlServer)) {
            Write-Warn "  SQL Server not available - some features may not work"
        }

        # Check 5: Database connection
        if (-not (Test-DatabaseConnection)) {
            Write-Warn "  Continuing anyway... (database may be unavailable)"
        }
    } else {
        Write-Info "Skipping Docker/SQL Server checks..."
    }
}

# Start the servers
Start-Servers
