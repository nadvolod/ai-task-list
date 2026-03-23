import { test, expect } from '@playwright/test';
import { login, quickAddTask } from './helpers/auth';

/** Format a Date as YYYY-MM-DD in local timezone (not UTC) */
function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

test.describe('Due date handling', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('task created via quick-add has no due date badge', async ({ page }) => {
    const taskTitle = `No date test ${Date.now()}`;
    await quickAddTask(page, taskTitle);

    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    await expect(taskCard.locator('text=Overdue')).not.toBeVisible();
    await expect(taskCard.locator('text=Due today')).not.toBeVisible();
    await expect(taskCard.locator('text=Tomorrow')).not.toBeVisible();
  });

  test('task created with due date shows badge', async ({ page }) => {
    await page.click('a[title="Add with details"]');
    await page.waitForURL('**/tasks/new');

    const taskTitle = `Due date test ${Date.now()}`;
    await page.fill('input[type="text"]', taskTitle);

    // Use local date to avoid UTC timezone shifts
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await page.fill('input[type="date"]', localDateString(tomorrow));

    await page.click('button[type="submit"]');
    await page.waitForURL('**/tasks');

    await expect(page.locator(`text=${taskTitle}`)).toBeVisible({ timeout: 10_000 });
    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    await expect(taskCard.locator('text=Tomorrow')).toBeVisible();
  });

  test('task with past due date shows Overdue badge', async ({ page }) => {
    await page.click('a[title="Add with details"]');
    await page.waitForURL('**/tasks/new');

    const taskTitle = `Overdue test ${Date.now()}`;
    await page.fill('input[type="text"]', taskTitle);

    // Use local date 2 days ago
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 2);
    await page.fill('input[type="date"]', localDateString(pastDate));

    await page.click('button[type="submit"]');
    await page.waitForURL('**/tasks');

    await expect(page.locator(`text=${taskTitle}`)).toBeVisible({ timeout: 10_000 });
    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    await expect(taskCard.locator('text=Overdue')).toBeVisible();
  });
});
