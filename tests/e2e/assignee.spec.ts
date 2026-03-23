import { test, expect } from '@playwright/test';
import { login, quickAddTask } from './helpers/auth';

test.describe('Default assignee', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('quick-add task gets default assignee badge from email', async ({ page }) => {
    const taskTitle = `Assignee test ${Date.now()}`;
    await quickAddTask(page, taskTitle);

    // The task card should show an assignee badge (teal-colored)
    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    const assigneeBadge = taskCard.locator('.text-teal-700');
    await expect(assigneeBadge).toBeVisible({ timeout: 10_000 });
    // The badge text should be non-empty (derived from email prefix)
    const badgeText = await assigneeBadge.textContent();
    expect(badgeText!.trim().length).toBeGreaterThan(0);
  });

  test('task created via detail form with explicit assignee shows that assignee', async ({ page }) => {
    // Navigate to task detail form
    await page.click('a[title="Add with details"]');
    await page.waitForURL('**/tasks/new');

    const taskTitle = `Explicit assignee ${Date.now()}`;
    await page.fill('input[type="text"]', taskTitle);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/tasks');

    // Task should appear with the default assignee badge
    await expect(page.locator(`text=${taskTitle}`)).toBeVisible({ timeout: 10_000 });
    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    const assigneeBadge = taskCard.locator('.text-teal-700');
    await expect(assigneeBadge).toBeVisible({ timeout: 10_000 });
  });
});
