import { test, expect } from '@playwright/test';

test('OAuth callback redirect should show dashboard', async ({ page }) => {
  // Listen for console logs
  page.on('console', msg => console.log('Browser:', msg.text()));

  // Simulate the OAuth callback redirect (this is what happens after Google OAuth)
  await page.goto('http://localhost:3000/?authenticated=true');

  // Wait for auth check to complete
  await page.waitForTimeout(3000);

  // Check final URL
  const url = page.url();
  console.log('Final URL:', url);

  // URL should be cleaned up (no query params)
  expect(url).toBe('http://localhost:3000/');

  // Should NOT be on login page
  expect(url).not.toContain('/login');

  // Should see dashboard content
  await expect(page.getByText('Sign in with Google')).not.toBeVisible();

  console.log('SUCCESS: OAuth callback redirect works!');
});
