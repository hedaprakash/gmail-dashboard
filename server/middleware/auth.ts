/**
 * Authentication Middleware
 *
 * Provides dual authentication for multi-user support:
 * 1. API Key authentication (for CLI/testing)
 * 2. Session-based authentication (for browser users)
 *
 * See ADR-002 for decision rationale.
 */

import { Request, Response, NextFunction } from 'express';
import { isAuthenticated } from '../services/gmail.js';

// Extend Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      user?: {
        email: string;
      };
    }
  }
}

// Extend express-session
declare module 'express-session' {
  interface SessionData {
    userEmail?: string;
  }
}

/**
 * Middleware to require authentication.
 * Supports two authentication methods:
 * 1. API Key (X-API-Key header) - for CLI/testing
 * 2. Session cookie - for browser users
 *
 * Returns 401 if neither authentication method succeeds.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // 1. Check API Key header (for CLI/testing)
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey && process.env.API_KEY && apiKey === process.env.API_KEY) {
    // For testing, also check X-Test-User header (only in non-production)
    const testUser = req.headers['x-test-user'] as string | undefined;
    if (testUser && process.env.NODE_ENV !== 'production') {
      req.user = { email: testUser };
    } else {
      // Use email from token.json or fallback
      const tokenAuth = isAuthenticated();
      req.user = { email: tokenAuth.email || process.env.DEFAULT_USER || 'api@localhost' };
    }
    next();
    return;
  }

  // 2. Check session (browser users)
  const userEmail = req.session?.userEmail;
  if (userEmail) {
    req.user = { email: userEmail };
    next();
    return;
  }

  // 3. No valid authentication
  res.status(401).json({
    success: false,
    error: 'Not authenticated',
    code: 'AUTH_REQUIRED'
  });
}

/**
 * Middleware that attaches user info if available, but doesn't require auth.
 * Useful for routes that work differently when authenticated vs not.
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const userEmail = req.session?.userEmail;

  if (userEmail) {
    req.user = { email: userEmail };
  }

  next();
}

/**
 * Get user email from request, with fallback for backwards compatibility.
 * During migration, uses 'default@user.com' if no session exists.
 */
export function getUserEmail(req: Request): string {
  return req.user?.email || req.session?.userEmail || 'default@user.com';
}
