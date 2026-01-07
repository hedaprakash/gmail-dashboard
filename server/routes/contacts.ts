/**
 * Contacts Routes
 *
 * API endpoints for managing Google Contacts.
 * All endpoints require authentication and are scoped to the current user.
 */

import { Router, Request, Response } from 'express';
import { getUserEmail } from '../middleware/auth.js';
import {
  syncContacts,
  getContacts,
  getContactDetails,
  findContactByEmail,
  getContactStats,
  clearPeopleServiceCache
} from '../services/contacts.js';

const router = Router();

/**
 * GET /api/contacts
 * Get paginated list of contacts.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userEmail = getUserEmail(req);
    const search = req.query.q as string | undefined;
    const offset = parseInt(req.query.offset as string) || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const result = await getContacts(userEmail, search, offset, limit);

    res.json({
      success: true,
      contacts: result.contacts,
      total: result.total,
      offset,
      limit,
      hasMore: offset + limit < result.total
    });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/contacts/stats
 * Get contact statistics.
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userEmail = getUserEmail(req);
    const stats = await getContactStats(userEmail);

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error fetching contact stats:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/contacts/sync
 * Sync contacts from Google People API.
 */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const userEmail = getUserEmail(req);

    console.log(`[${userEmail}] Starting contacts sync...`);

    // Clear cached service to ensure fresh auth
    clearPeopleServiceCache();

    const result = await syncContacts(userEmail);

    res.json({
      success: true,
      message: `Synced ${result.synced} contacts`,
      result
    });
  } catch (error) {
    console.error('Error syncing contacts:', error);

    // Check for specific error types
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage === 'NOT_AUTHENTICATED') {
      res.status(401).json({
        success: false,
        error: 'Not authenticated. Please log in again.',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    // Check if it's a scope error (user needs to re-authenticate with new scope)
    if (errorMessage.includes('insufficient') || errorMessage.includes('scope')) {
      res.status(403).json({
        success: false,
        error: 'Contacts permission not granted. Please log out and log in again to grant contacts access.',
        code: 'SCOPE_REQUIRED'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

/**
 * GET /api/contacts/by-email/:email
 * Find contact by email address.
 */
router.get('/by-email/:email', async (req: Request, res: Response) => {
  try {
    const userEmail = getUserEmail(req);
    const emailToFind = req.params.email;

    const contact = await findContactByEmail(userEmail, emailToFind);

    if (!contact) {
      res.json({
        success: true,
        found: false,
        contact: null
      });
      return;
    }

    res.json({
      success: true,
      found: true,
      contact
    });
  } catch (error) {
    console.error('Error finding contact:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/contacts/:id
 * Get detailed contact info.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userEmail = getUserEmail(req);
    const contactId = parseInt(req.params.id);

    if (isNaN(contactId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid contact ID'
      });
      return;
    }

    const contact = await getContactDetails(contactId, userEmail);

    if (!contact) {
      res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
      return;
    }

    res.json({
      success: true,
      contact
    });
  } catch (error) {
    console.error('Error fetching contact details:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
