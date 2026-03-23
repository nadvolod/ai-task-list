import { type Page } from '@playwright/test';

const E2E_EMAIL = process.env.E2E_TEST_EMAIL ?? 'e2e-test@test.com';
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD ?? 'testpass123';

/**
 * Sign in to the app via the signin page.
 * Assumes the test user already exists in the database.
 */
export async function login(page: Page) {
  await page.goto('/auth/signin');
  await page.fill('input[type="email"]', E2E_EMAIL);
  await page.fill('input[type="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for redirect to tasks page
  await page.waitForURL('**/tasks', { timeout: 15_000 });
}

/**
 * Create a task via the quick-add form.
 */
export async function quickAddTask(page: Page, title: string) {
  // Open quick add
  await page.click('text=+ Add task');
  // Type title
  await page.fill('input[placeholder="What needs to happen?"]', title);
  // Submit
  await page.click('button:has-text("Add")');
  // Wait for task to appear
  await page.waitForSelector(`text=${title}`, { timeout: 15_000 });
}
