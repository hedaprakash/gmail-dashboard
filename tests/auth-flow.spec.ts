import { test, expect } from '@playwright/test';

test.describe.serial('Auth Flow Tests', () => {

  test('Step 1: Backend shows authenticated', async ({ request }) => {
    const response = await request.get('http://localhost:5000/auth/status');
    const data = await response.json();
    console.log('Backend auth status:', data);
    expect(data.authenticated).toBe(true);
  });

  test('Step 2: Frontend fetches auth status correctly', async ({ page }) => {
    // Listen for console logs
    page.on('console', msg => console.log('Browser console:', msg.text()));

    // Go to the app
    await page.goto('http://localhost:3000/');

    // Wait for auth check to complete (look for either dashboard or login)
    await page.waitForTimeout(3000);

    // Check what URL we're on
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);

    // Take a screenshot
    await page.screenshot({ path: 'test-results/auth-flow-step2.png' });
  });

  test('Step 3: Should show dashboard when authenticated', async ({ page }) => {
    page.on('console', msg => console.log('Browser:', msg.text()));

    await page.goto('http://localhost:3000/');

    // Wait for the page to settle
    await page.waitForTimeout(2000);

    const url = page.url();
    console.log('Final URL:', url);

    // Should NOT be on login page
    expect(url).not.toContain('/login');

    // Should be on root
    expect(url).toBe('http://localhost:3000/');
  });

  test('Step 4: After logout, should show login page', async ({ page, request }) => {
    // Logout
    await request.post('http://localhost:5000/auth/logout');

    // Verify backend shows not authenticated
    const status = await request.get('http://localhost:5000/auth/status');
    const data = await status.json();
    console.log('After logout:', data);
    expect(data.authenticated).toBe(false);

    // Now go to frontend
    await page.goto('http://localhost:3000/');
    await page.waitForTimeout(2000);

    // Should redirect to login
    expect(page.url()).toContain('/login');

    // Should see login button
    await expect(page.getByText('Sign in with Google')).toBeVisible();
  });
});
