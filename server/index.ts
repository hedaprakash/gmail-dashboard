/**
 * Gmail Dashboard Server
 *
 * Express server providing REST API for email management.
 * Supports multi-user authentication via session-based auth.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import session from 'express-session';

import emailRoutes from './routes/emails.js';
import criteriaRoutes from './routes/criteria.js';
import actionRoutes from './routes/actions.js';
import executeRoutes from './routes/execute.js';
import authRoutes from './routes/auth.js';
import contactsRoutes from './routes/contacts.js';
import testingRoutes from './routes/testing.js';
import { requireAuth } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Session secret - in production, use environment variable
const SESSION_SECRET = process.env.SESSION_SECRET || 'gmail-dashboard-secret-key-change-in-production';

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true  // Allow cookies/sessions
}));
app.use(express.json());

// Session middleware for multi-user support
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
  }
}));

// Auth Routes (OAuth flow - no /api prefix, no auth required)
app.use('/auth', authRoutes);

// Protected API Routes (require authentication)
app.use('/api/emails', requireAuth, emailRoutes);
app.use('/api/criteria', requireAuth, criteriaRoutes);
app.use('/api/actions', requireAuth, actionRoutes);
app.use('/api/execute', requireAuth, executeRoutes);
app.use('/api/contacts', requireAuth, contactsRoutes);
app.use('/api/testing', requireAuth, testingRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const staticPath = path.join(process.cwd(), 'dist');
  app.use(express.static(staticPath));

  // Fallback to index.html for SPA routing
  app.get('*', (_req, res) => {
    res.sendFile(path.join(staticPath, 'index.html'));
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`Gmail Dashboard server running on http://localhost:${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  GET  /api/emails       - List grouped emails`);
  console.log(`  POST /api/emails/refresh - Refresh from Gmail`);
  console.log(`  GET  /api/emails/stats - Get statistics`);
  console.log(`  GET  /api/criteria     - List all criteria`);
  console.log(`  POST /api/actions/mark-keep - Mark as keep`);
  console.log(`  POST /api/actions/add-criteria - Add to delete`);
  console.log(`  POST /api/execute/preview - Preview deletion`);
  console.log(`  POST /api/execute/delete - Execute deletion`);
  console.log(`  GET  /api/testing/scenarios - List test scenarios`);
  console.log(`  POST /api/testing/run/:id - Run single test`);
  console.log(`  POST /api/testing/run-all - Run all tests`);
  console.log(`  POST /api/testing/reset - Reset test data`);
  console.log(`  GET  /auth/status     - Check auth status`);
  console.log(`  GET  /auth/login      - Start OAuth flow`);
  console.log(`  GET  /auth/callback   - OAuth callback`);
  console.log(`  POST /auth/logout     - Logout`);
});

export default app;
