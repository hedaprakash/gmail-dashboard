import { test, expect } from '@playwright/test';

test.describe('OAuth Callback Redirect', () => {

  test('should handle /?authenticated=true redirect and show dashboard', async ({ page }) => {
    // Listen for console logs
    page.on('console', msg => console.log('Browser:', msg.text()));

    // Simulate the OAuth callback redirect (what happens after Google OAuth)
    await page.goto('http://localhost:3000/?authenticated=true');

    // Wait for auth check to complete
    await page.waitForTimeout(2000);

    // URL should be cleaned up (no query params)
    const url = page.url();
    console.log('Final URL:', url);
    expect(url).toBe('http://localhost:3000/');
    expect(url).not.toContain('authenticated=true');

    // Should show dashboard content, not login
    await expect(page.getByText('Sign in with Google')).not.toBeVisible();

    // Should see some dashboard element
    const hasRefreshButton = await page.getByText('Refresh from Gmail').isVisible().catch(() => false);
    const hasLoading = await page.getByText('Loading').isVisible().catch(() => false);
    const hasStats = await page.locator('.grid').first().isVisible().catch(() => false);

    console.log('Dashboard elements visible:', { hasRefreshButton, hasLoading, hasStats });
    expect(hasRefreshButton || hasLoading || hasStats).toBe(true);
  });

  test('full flow: logout -> login page -> simulate callback -> dashboard', async ({ page, request }) => {
    page.on('console', msg => console.log('Browser:', msg.text()));

    // Step 1: Logout
    console.log('Step 1: Logging out...');
    await request.post('http://localhost:5000/auth/logout');

    // Step 2: Go to app, should redirect to login
    console.log('Step 2: Going to app...');
    await page.goto('http://localhost:3000/');
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/login');
    console.log('Correctly on login page');

    // Step 3: Create token (simulates what OAuth callback does)
    console.log('Step 3: Creating token...');
    const fs = await import('fs');
    fs.writeFileSync('D:/myprojects/gmail/gmail-dashboard/data/token.json', JSON.stringify({
      access_token: "test_token",
      refresh_token: "test_refresh",
      scope: "https://mail.google.com/",
      token_type: "Bearer",
      expiry_date: 9999999999999
    }));

    // Step 4: Navigate to /?authenticated=true (what callback does)
    console.log('Step 4: Simulating callback redirect...');
    await page.goto('http://localhost:3000/?authenticated=true');
    await page.waitForTimeout(2000);

    // Step 5: Verify we're on dashboard
    console.log('Step 5: Verifying dashboard...');
    const finalUrl = page.url();
    console.log('Final URL:', finalUrl);

    expect(finalUrl).toBe('http://localhost:3000/');
    expect(finalUrl).not.toContain('/login');

    console.log('SUCCESS: Full flow works!');
  });
});
