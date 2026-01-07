/**
 * Auth Routes
 *
 * Handles Google OAuth authentication with multi-user session support.
 */

import { Router, Request, Response } from 'express';
import {
  isAuthenticated,
  getAuthUrl,
  handleAuthCallback,
  clearAuth
} from '../services/gmail.js';
import { migrateUserData } from '../services/database.js';

const router = Router();

/**
 * GET /auth/status
 * Check if user is authenticated (via session or token).
 */
router.get('/status', (req: Request, res: Response) => {
  try {
    // Check session first (multi-user mode)
    if (req.session?.userEmail) {
      res.json({
        success: true,
        authenticated: true,
        email: req.session.userEmail
      });
      return;
    }

    // Fall back to token check (single-user backwards compat)
    const status = isAuthenticated();
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error('Error checking auth status:', error);
    res.status(500).json({
      success: false,
      authenticated: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /auth/login
 * Redirect user to Google OAuth consent screen.
 */
router.get('/login', (_req: Request, res: Response) => {
  try {
    const authUrl = getAuthUrl();
    res.redirect(authUrl);
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /auth/callback
 * Handle OAuth callback from Google.
 * Sets up session for multi-user support and migrates data if needed.
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;

    if (!code) {
      res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>Authentication Failed</h1>
            <p>No authorization code received.</p>
            <a href="/">Return to Dashboard</a>
          </body>
        </html>
      `);
      return;
    }

    const result = await handleAuthCallback(code);

    if (result.success && result.email) {
      // Set session for multi-user support
      req.session.userEmail = result.email;

      // Migrate default user data to this user if this is their first login
      try {
        await migrateUserData('default@user.com', result.email);
        console.log(`Migrated data for user: ${result.email}`);
      } catch (err) {
        // Non-fatal: user might already have data or no default data exists
        console.log(`Data migration skipped for ${result.email}:`, err);
      }

      // Save session before redirect
      req.session.save((err) => {
        if (err) {
          console.error('Error saving session:', err);
        }
        res.redirect('http://localhost:3000/?authenticated=true');
      });
    } else if (result.success) {
      // OAuth succeeded but no email - redirect anyway
      res.redirect('http://localhost:3000/?authenticated=true');
    } else {
      res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>Authentication Failed</h1>
            <p>${result.error || 'Unknown error occurred'}</p>
            <a href="/auth/login">Try Again</a>
          </body>
        </html>
      `);
    }
  } catch (error) {
    console.error('Error in auth callback:', error);
    res.status(500).send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Authentication Error</h1>
          <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
          <a href="/auth/login">Try Again</a>
        </body>
      </html>
    `);
  }
});

/**
 * POST /auth/logout
 * Clear authentication and session.
 * Removes tokens from both database and file.
 */
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const userEmail = req.session?.userEmail;

    // Clear OAuth token from database and file
    await clearAuth(userEmail);

    // Clear session
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying session:', err);
      }
    });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Error logging out:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
