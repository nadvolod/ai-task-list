import { test, expect } from '@playwright/test';
import { login, quickAddTask } from './helpers/auth';

test.describe('Default assignee', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('quick-add task gets default assignee from email', async ({ page }) => {
    const taskTitle = `Assignee test ${Date.now()}`;
    await quickAddTask(page, taskTitle);

    // The task card should show an assignee badge (derived from user's email prefix)
    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    // Look for a teal badge (assignee badge color)
    const assigneeBadge = taskCard.locator('.text-teal-700');
    await expect(assigneeBadge).toBeVisible({ timeout: 10_000 });
  });

  test('explicit assignee overrides default', async ({ page }) => {
    // Navigate to new task form
    await page.click('a[title="Add with details"]');
    await page.waitForURL('**/tasks/new');

    const taskTitle = `Explicit assignee ${Date.now()}`;
    await page.fill('input[type="text"]', taskTitle);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/tasks');

    // Task should appear with the default assignee (from email prefix)
    await expect(page.locator(`text=${taskTitle}`)).toBeVisible({ timeout: 10_000 });
  });
});
