/**
 * Gmail Dashboard Server
 *
 * Express server providing REST API for email management.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';

import emailRoutes from './routes/emails.js';
import criteriaRoutes from './routes/criteria.js';
import actionRoutes from './routes/actions.js';
import executeRoutes from './routes/execute.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/emails', emailRoutes);
app.use('/api/criteria', criteriaRoutes);
app.use('/api/actions', actionRoutes);
app.use('/api/execute', executeRoutes);

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
});

export default app;
