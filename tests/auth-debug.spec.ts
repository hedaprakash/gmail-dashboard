import { test, expect } from '@playwright/test';

test('debug: check what browser sees for auth status', async ({ page }) => {
  // Go to a blank page first
  await page.goto('http://localhost:3000/login');

  // Fetch auth status from the browser context
  const authResponse = await page.evaluate(async () => {
    const response = await fetch('/auth/status');
    return {
      status: response.status,
      body: await response.json()
    };
  });

  console.log('Auth status from browser:', JSON.stringify(authResponse, null, 2));

  // Also check via page.request
  const directResponse = await page.request.get('http://localhost:3000/auth/status');
  console.log('Direct request status:', directResponse.status());
  console.log('Direct request body:', await directResponse.json());
});
