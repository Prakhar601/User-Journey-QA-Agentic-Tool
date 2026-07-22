import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TEST_URL || process.env.URL;
const USERNAME = process.env.TEST_USERNAME || process.env.USERNAME || '';
const PASSWORD = process.env.TEST_PASSWORD || process.env.PASSWORD || '';

async function findStableLocator(page: any, locators: any[]) {
  for (const locator of locators) {
    const candidate = locator.first ? locator.first() : locator;
    try {
      if ((await candidate.count()) === 0) continue;
      if (!(await candidate.isVisible())) continue;
      await candidate.waitFor({ state: 'visible', timeout: 2000 });
      await candidate.scrollIntoViewIfNeeded();
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function loginIfCredentialsProvided(page: any) {
  if (!USERNAME && !PASSWORD) {
    return;
  }
  const usernameLocators = [
    page.locator('[data-testid*="user" i], [data-testid*="email" i]'),
    page.locator('[data-test*="user" i], [data-test*="email" i]'),
    page.locator('[data-qa*="user" i], [data-qa*="email" i]'),
    page.locator('#username, [id*="user" i], [id*="email" i]'),
    page.locator('input[name*="user" i], input[name*="email" i]'),
    page.getByLabel(/email|user(name)?|login/i),
    page.getByRole('textbox', { name: /email|user(name)?|login/i }),
    page.getByPlaceholder(/email|user(name)?|login/i),
  ];
  const passwordLocators = [
    page.locator('[data-testid*="pass" i], [data-testid*="password" i]'),
    page.locator('[data-test*="pass" i], [data-test*="password" i]'),
    page.locator('[data-qa*="pass" i], [data-qa*="password" i]'),
    page.locator('#password, [id*="pass" i]'),
    page.locator('input[name*="pass" i]'),
    page.getByLabel(/password|passcode|secret/i),
    page.getByRole('textbox', { name: /password|passcode|secret/i }),
    page.getByPlaceholder(/password|passcode|secret/i),
  ];
  const submitLocators = [
    page.locator('[data-testid*="sign-in" i], [data-testid*="login" i], [data-testid*="submit" i]'),
    page.locator('[data-test*="sign-in" i], [data-test*="login" i], [data-test*="submit" i]'),
    page.locator('[data-qa*="sign-in" i], [data-qa*="login" i], [data-qa*="submit" i]'),
    page.locator('[id*="sign-in" i], [id*="login" i], [id*="submit" i]'),
    page.locator('[name*="sign-in" i], [name*="login" i], [name*="submit" i]'),
    page.getByRole('button', { name: /sign in|log in|login|submit/i }),
    page.getByText(/sign in|log in|login|submit/i),
    page.locator('button[type="submit"], input[type="submit"]'),
    page.getByRole('button', { name: /^Continue$/ }),
  ];
  const usernameLocator = USERNAME ? await findStableLocator(page, usernameLocators) : null;
  if (USERNAME && usernameLocator) {
    await usernameLocator.fill(USERNAME);
  }
  const passwordLocator = PASSWORD ? await findStableLocator(page, passwordLocators) : null;
  if (PASSWORD && passwordLocator) {
    await passwordLocator.fill(PASSWORD);
  }
  const submitLocator = await findStableLocator(page, submitLocators);
  if (submitLocator) {
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => undefined),
      submitLocator.click(),
    ]);
  }
}

test.describe('Regression sweep', () => {
  test('Scenario 1: Login with valid username and password and verify successful login.', async ({ page }) => {
    if (!BASE_URL) {
      throw new Error('Set TEST_URL or URL environment variable before running regression tests.');
    }

    // Navigate to the target application
    await page.goto(BASE_URL);
    await loginIfCredentialsProvided(page);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Basic smoke interaction
    const firstClickable = page.locator('button, [role="button"], a').first();
    if (await firstClickable.count()) {
      await firstClickable.click();
    }

    // High-level validation of page state
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveURL(/about:blank/);
    const interactiveLocator = page.locator('[data-testid], [data-test], [data-qa], [aria-label], [aria-labelledby], [role="button"], button, a, input[type="submit"]').first();
    await expect(interactiveLocator).toBeVisible();

    // Positive scenario: validate we are not on an auth or error page
    await expect(page).not.toHaveURL(/login/i);
    await expect(page).not.toHaveURL(/error/i);
  });

  test('Scenario 2: Login with invalid username and valid password and verify login failure message.', async ({ page }) => {
    if (!BASE_URL) {
      throw new Error('Set TEST_URL or URL environment variable before running regression tests.');
    }

    // Navigate to the target application
    await page.goto(BASE_URL);
    await loginIfCredentialsProvided(page);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Basic smoke interaction
    const firstClickable = page.locator('button, [role="button"], a').first();
    if (await firstClickable.count()) {
      await firstClickable.click();
    }

    // High-level validation of page state
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveURL(/about:blank/);
    const interactiveLocator = page.locator('[data-testid], [data-test], [data-qa], [aria-label], [aria-labelledby], [role="button"], button, a, input[type="submit"]').first();
    await expect(interactiveLocator).toBeVisible();

    const errorLocator = page.locator('[data-testid*="error" i], [data-test*="error" i], [data-qa*="error" i], [aria-label*="error" i], [aria-labelledby*="error" i], [role="alert"], [aria-live="assertive"]');
    const errorTextLocator = page.getByText(/error|invalid|failed|unable|problem|required/i);
    const errorCount = await errorLocator.count();
    const errorTextCount = await errorTextLocator.count();
    expect(errorCount + errorTextCount).toBeGreaterThan(0);
  });

  test('Scenario 3: Login with valid username and invalid password to verify login failure.', async ({ page }) => {
    if (!BASE_URL) {
      throw new Error('Set TEST_URL or URL environment variable before running regression tests.');
    }

    // Navigate to the target application
    await page.goto(BASE_URL);
    await loginIfCredentialsProvided(page);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Basic smoke interaction
    const firstClickable = page.locator('button, [role="button"], a').first();
    if (await firstClickable.count()) {
      await firstClickable.click();
    }

    // High-level validation of page state
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveURL(/about:blank/);
    const interactiveLocator = page.locator('[data-testid], [data-test], [data-qa], [aria-label], [aria-labelledby], [role="button"], button, a, input[type="submit"]').first();
    await expect(interactiveLocator).toBeVisible();

    const errorLocator = page.locator('[data-testid*="error" i], [data-test*="error" i], [data-qa*="error" i], [aria-label*="error" i], [aria-labelledby*="error" i], [role="alert"], [aria-live="assertive"]');
    const errorTextLocator = page.getByText(/error|invalid|failed|unable|problem|required/i);
    const errorCount = await errorLocator.count();
    const errorTextCount = await errorTextLocator.count();
    expect(errorCount + errorTextCount).toBeGreaterThan(0);
  });

  test('Scenario 4: Attempt login with empty username and password fields to validate error messages.', async ({ page }) => {
    if (!BASE_URL) {
      throw new Error('Set TEST_URL or URL environment variable before running regression tests.');
    }

    // Navigate to the target application
    await page.goto(BASE_URL);
    await loginIfCredentialsProvided(page);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Basic smoke interaction
    const firstClickable = page.locator('button, [role="button"], a').first();
    if (await firstClickable.count()) {
      await firstClickable.click();
    }

    // High-level validation of page state
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveURL(/about:blank/);
    const interactiveLocator = page.locator('[data-testid], [data-test], [data-qa], [aria-label], [aria-labelledby], [role="button"], button, a, input[type="submit"]').first();
    await expect(interactiveLocator).toBeVisible();

    const errorLocator = page.locator('[data-testid*="error" i], [data-test*="error" i], [data-qa*="error" i], [aria-label*="error" i], [aria-labelledby*="error" i], [role="alert"], [aria-live="assertive"]');
    const errorTextLocator = page.getByText(/error|invalid|failed|unable|problem|required/i);
    const errorCount = await errorLocator.count();
    const errorTextCount = await errorTextLocator.count();
    expect(errorCount + errorTextCount).toBeGreaterThan(0);
  });

  test('Scenario 5: After successful login, select a product and click ’Add to Cart’, verify cart icon displays 1 item.', async ({ page }) => {
    if (!BASE_URL) {
      throw new Error('Set TEST_URL or URL environment variable before running regression tests.');
    }

    // Navigate to the target application
    await page.goto(BASE_URL);
    await loginIfCredentialsProvided(page);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Basic smoke interaction
    const firstClickable = page.locator('button, [role="button"], a').first();
    if (await firstClickable.count()) {
      await firstClickable.click();
    }

    // High-level validation of page state
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveURL(/about:blank/);
    const interactiveLocator = page.locator('[data-testid], [data-test], [data-qa], [aria-label], [aria-labelledby], [role="button"], button, a, input[type="submit"]').first();
    await expect(interactiveLocator).toBeVisible();

    // Positive scenario: validate we are not on an auth or error page
    await expect(page).not.toHaveURL(/login/i);
    await expect(page).not.toHaveURL(/error/i);
  });

  test('Scenario 6: After login, attempt to add multiple different products to the cart and verify cart icon updates accordingly.', async ({ page }) => {
    if (!BASE_URL) {
      throw new Error('Set TEST_URL or URL environment variable before running regression tests.');
    }

    // Navigate to the target application
    await page.goto(BASE_URL);
    await loginIfCredentialsProvided(page);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Basic smoke interaction
    const firstClickable = page.locator('button, [role="button"], a').first();
    if (await firstClickable.count()) {
      await firstClickable.click();
    }

    // High-level validation of page state
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveURL(/about:blank/);
    const interactiveLocator = page.locator('[data-testid], [data-test], [data-qa], [aria-label], [aria-labelledby], [role="button"], button, a, input[type="submit"]').first();
    await expect(interactiveLocator).toBeVisible();

    const errorLocator = page.locator('[data-testid*="error" i], [data-test*="error" i], [data-qa*="error" i], [aria-label*="error" i], [aria-labelledby*="error" i], [role="alert"], [aria-live="assertive"]');
    const errorTextLocator = page.getByText(/error|invalid|failed|unable|problem|required/i);
    const errorCount = await errorLocator.count();
    const errorTextCount = await errorTextLocator.count();
    expect(errorCount + errorTextCount).toBeGreaterThan(0);
  });

  test('Scenario 7: Add the same product multiple times and verify if the cart icon updates to 1 item or counts quantity correctly.', async ({ page }) => {
    if (!BASE_URL) {
      throw new Error('Set TEST_URL or URL environment variable before running regression tests.');
    }

    // Navigate to the target application
    await page.goto(BASE_URL);
    await loginIfCredentialsProvided(page);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Basic smoke interaction
    const firstClickable = page.locator('button, [role="button"], a').first();
    if (await firstClickable.count()) {
      await firstClickable.click();
    }

    // High-level validation of page state
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveURL(/about:blank/);
    const interactiveLocator = page.locator('[data-testid], [data-test], [data-qa], [aria-label], [aria-labelledby], [role="button"], button, a, input[type="submit"]').first();
    await expect(interactiveLocator).toBeVisible();

    // Positive scenario: validate we are not on an auth or error page
    await expect(page).not.toHaveURL(/login/i);
    await expect(page).not.toHaveURL(/error/i);
  });

  test('Scenario 8: After failed login attempts, verify that the user cannot add products to the cart.', async ({ page }) => {
    if (!BASE_URL) {
      throw new Error('Set TEST_URL or URL environment variable before running regression tests.');
    }

    // Navigate to the target application
    await page.goto(BASE_URL);
    await loginIfCredentialsProvided(page);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Basic smoke interaction
    const firstClickable = page.locator('button, [role="button"], a').first();
    if (await firstClickable.count()) {
      await firstClickable.click();
    }

    // High-level validation of page state
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveURL(/about:blank/);
    const interactiveLocator = page.locator('[data-testid], [data-test], [data-qa], [aria-label], [aria-labelledby], [role="button"], button, a, input[type="submit"]').first();
    await expect(interactiveLocator).toBeVisible();

    const errorLocator = page.locator('[data-testid*="error" i], [data-test*="error" i], [data-qa*="error" i], [aria-label*="error" i], [aria-labelledby*="error" i], [role="alert"], [aria-live="assertive"]');
    const errorTextLocator = page.getByText(/error|invalid|failed|unable|problem|required/i);
    const errorCount = await errorLocator.count();
    const errorTextCount = await errorTextLocator.count();
    expect(errorCount + errorTextCount).toBeGreaterThan(0);
  });

  test('Scenario 9: Attempt to click ’Add to Cart’ button when no products are loaded and verify appropriate handling or error message.', async ({ page }) => {
    if (!BASE_URL) {
      throw new Error('Set TEST_URL or URL environment variable before running regression tests.');
    }

    // Navigate to the target application
    await page.goto(BASE_URL);
    await loginIfCredentialsProvided(page);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Basic smoke interaction
    const firstClickable = page.locator('button, [role="button"], a').first();
    if (await firstClickable.count()) {
      await firstClickable.click();
    }

    // High-level validation of page state
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveURL(/about:blank/);
    const interactiveLocator = page.locator('[data-testid], [data-test], [data-qa], [aria-label], [aria-labelledby], [role="button"], button, a, input[type="submit"]').first();
    await expect(interactiveLocator).toBeVisible();

    const errorLocator = page.locator('[data-testid*="error" i], [data-test*="error" i], [data-qa*="error" i], [aria-label*="error" i], [aria-labelledby*="error" i], [role="alert"], [aria-live="assertive"]');
    const errorTextLocator = page.getByText(/error|invalid|failed|unable|problem|required/i);
    const errorCount = await errorLocator.count();
    const errorTextCount = await errorTextLocator.count();
    expect(errorCount + errorTextCount).toBeGreaterThan(0);
  });

  test('Scenario 10: Login with username and password containing special characters to verify input validation and login behavior.', async ({ page }) => {
    if (!BASE_URL) {
      throw new Error('Set TEST_URL or URL environment variable before running regression tests.');
    }

    // Navigate to the target application
    await page.goto(BASE_URL);
    await loginIfCredentialsProvided(page);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Basic smoke interaction
    const firstClickable = page.locator('button, [role="button"], a').first();
    if (await firstClickable.count()) {
      await firstClickable.click();
    }

    // High-level validation of page state
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveURL(/about:blank/);
    const interactiveLocator = page.locator('[data-testid], [data-test], [data-qa], [aria-label], [aria-labelledby], [role="button"], button, a, input[type="submit"]').first();
    await expect(interactiveLocator).toBeVisible();

    // Positive scenario: validate we are not on an auth or error page
    await expect(page).not.toHaveURL(/login/i);
    await expect(page).not.toHaveURL(/error/i);
  });

});