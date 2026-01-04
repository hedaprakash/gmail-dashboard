/**
 * Auth Routes
 *
 * Handles Google OAuth authentication.
 */

import { Router, Request, Response } from 'express';
import {
  isAuthenticated,
  getAuthUrl,
  handleAuthCallback,
  clearAuth
} from '../services/gmail.js';

const router = Router();

/**
 * GET /auth/status
 * Check if user is authenticated.
 */
router.get('/status', (_req: Request, res: Response) => {
  try {
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
    
    if (result.success) {
      // Redirect to frontend
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
 * Clear authentication.
 */
router.post('/logout', (_req: Request, res: Response) => {
  try {
    clearAuth();
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
