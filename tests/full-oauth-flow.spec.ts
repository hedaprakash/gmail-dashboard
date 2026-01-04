import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const TOKEN_PATH = 'D:/myprojects/gmail/gmail-dashboard/data/token.json';

test('Full OAuth flow simulation', async ({ page }) => {
  page.on('console', msg => console.log('Browser:', msg.text()));

  // Step 1: Logout via browser fetch (avoids IPv6 issues)
  console.log('Step 1: Logging out...');
  await page.goto('http://localhost:3000/login');
  await page.evaluate(async () => {
    await fetch('/auth/logout', { method: 'POST' });
  });
  await page.waitForTimeout(500);

  // Verify logged out via browser
  const logoutStatus = await page.evaluate(async () => {
    const res = await fetch('/auth/status');
    return res.json();
  });
  expect(logoutStatus.authenticated).toBe(false);
  console.log('Logged out successfully');

  // Step 2: Reload to show login page
  console.log('Step 2: Verifying login page...');
  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(1000);
  expect(page.url()).toContain('/login');
  await expect(page.getByText('Sign in with Google')).toBeVisible();
  console.log('Login page shown correctly');

  // Step 3: Simulate OAuth callback (what the server does)
  console.log('Step 3: Simulating OAuth callback - creating token...');
  fs.writeFileSync(TOKEN_PATH, JSON.stringify({
    access_token: "simulated_oauth_token",
    refresh_token: "simulated_refresh_token",
    scope: "https://mail.google.com/",
    token_type: "Bearer",
    expiry_date: Date.now() + 3600000  // 1 hour from now
  }, null, 2));

  // Wait for file to be written and server to settle
  await page.waitForTimeout(1000);

  // Verify backend sees the token via browser fetch
  const authData = await page.evaluate(async () => {
    const res = await fetch('/auth/status');
    return res.json();
  });
  console.log('Backend auth status:', authData);
  expect(authData.authenticated).toBe(true);

  // Step 4: Navigate to the callback redirect URL
  console.log('Step 4: Simulating callback redirect...');
  await page.goto('http://localhost:3000/?authenticated=true');
  await page.waitForTimeout(2000);

  // Step 5: Verify we're on dashboard
  console.log('Step 5: Verifying dashboard...');
  const finalUrl = page.url();
  console.log('Final URL:', finalUrl);

  expect(finalUrl).toBe('http://localhost:3000/');
  expect(finalUrl).not.toContain('/login');
  expect(finalUrl).not.toContain('authenticated=true');

  // Verify dashboard content is visible
  await expect(page.getByText('Sign in with Google')).not.toBeVisible();

  console.log('SUCCESS: Full OAuth flow works!');
});
