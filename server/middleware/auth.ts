/**
 * Authentication Middleware
 *
 * Provides session-based authentication for multi-user support.
 * Extracts user email from session and attaches to request object.
 */

import { Request, Response, NextFunction } from 'express';

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
 * Returns 401 if user is not authenticated.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userEmail = req.session?.userEmail;

  if (!userEmail) {
    res.status(401).json({
      success: false,
      error: 'Not authenticated',
      code: 'AUTH_REQUIRED'
    });
    return;
  }

  // Attach user to request
  req.user = { email: userEmail };
  next();
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
