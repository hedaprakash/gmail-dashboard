import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('should show login page when not authenticated', async ({ page }) => {
    // First, logout to ensure clean state
    await fetch('http://localhost:5000/auth/logout', { method: 'POST' });

    // Wait a moment for the server to process
    await page.waitForTimeout(500);

    // Go to homepage
    await page.goto('http://localhost:3000/');

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);

    // Should see login button
    await expect(page.getByText('Sign in with Google')).toBeVisible();
  });

  test('should show dashboard when authenticated', async ({ page }) => {
    // Check if we're authenticated first
    const response = await fetch('http://localhost:5000/auth/status');
    const data = await response.json();

    if (!data.authenticated) {
      console.log('Skipping test - not authenticated. Run OAuth flow manually first.');
      test.skip();
      return;
    }

    // Go to homepage
    await page.goto('http://localhost:3000/');

    // Should stay on homepage (not redirect to login)
    await expect(page).toHaveURL('http://localhost:3000/');

    // Should see dashboard content
    await expect(page.locator('text=Refresh from Gmail').or(page.locator('text=Loading'))).toBeVisible({ timeout: 10000 });
  });

  test('should redirect to dashboard after OAuth callback simulation', async ({ page, request }) => {
    // This test simulates what happens after OAuth callback
    // by going directly to /?authenticated=true when already authenticated

    const response = await fetch('http://localhost:5000/auth/status');
    const data = await response.json();

    if (!data.authenticated) {
      console.log('Skipping test - not authenticated');
      test.skip();
      return;
    }

    // Simulate the OAuth callback redirect
    await page.goto('http://localhost:3000/?authenticated=true');

    // Should clean up URL and show dashboard
    await page.waitForURL('http://localhost:3000/', { timeout: 5000 });

    // URL should not have query params
    expect(page.url()).not.toContain('authenticated=true');
  });

  test('login button should redirect to OAuth', async ({ page }) => {
    // Logout first
    await fetch('http://localhost:5000/auth/logout', { method: 'POST' });
    await page.waitForTimeout(500);

    // Go to login page
    await page.goto('http://localhost:3000/login');

    // Click sign in button
    const loginButton = page.getByText('Sign in with Google');
    await expect(loginButton).toBeVisible();

    // Get the href/onclick action - we'll check it redirects to Google
    await loginButton.click();

    // Should redirect to Google OAuth (or our /auth/login endpoint)
    // Wait for navigation
    await page.waitForURL(/accounts\.google\.com|localhost:5000\/auth\/login/, { timeout: 10000 });
  });
});
