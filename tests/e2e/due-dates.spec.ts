import { test, expect } from '@playwright/test';
import { login, quickAddTask } from './helpers/auth';

test.describe('Due date handling', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('task created via quick-add has no due date badge', async ({ page }) => {
    const taskTitle = `No date test ${Date.now()}`;
    await quickAddTask(page, taskTitle);

    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    // Should NOT have any due date badges (Overdue, Due today, Tomorrow, Due xxx)
    await expect(taskCard.locator('text=Overdue')).not.toBeVisible();
    await expect(taskCard.locator('text=Due today')).not.toBeVisible();
    await expect(taskCard.locator('text=Tomorrow')).not.toBeVisible();
  });

  test('task created with due date shows badge', async ({ page }) => {
    // Go to new task form
    await page.click('a[title="Add with details"]');
    await page.waitForURL('**/tasks/new');

    const taskTitle = `Due date test ${Date.now()}`;
    await page.fill('input[type="text"]', taskTitle);

    // Set a due date for tomorrow
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dateStr = tomorrow.toISOString().split('T')[0];
    await page.fill('input[type="date"]', dateStr);

    await page.click('button[type="submit"]');
    await page.waitForURL('**/tasks');

    // Task should appear with "Tomorrow" badge
    await expect(page.locator(`text=${taskTitle}`)).toBeVisible({ timeout: 10_000 });
    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    await expect(taskCard.locator('text=Tomorrow')).toBeVisible();
  });

  test('task with past due date shows Overdue badge', async ({ page }) => {
    // Go to new task form
    await page.click('a[title="Add with details"]');
    await page.waitForURL('**/tasks/new');

    const taskTitle = `Overdue test ${Date.now()}`;
    await page.fill('input[type="text"]', taskTitle);

    // Set a past due date
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const dateStr = yesterday.toISOString().split('T')[0];
    await page.fill('input[type="date"]', dateStr);

    await page.click('button[type="submit"]');
    await page.waitForURL('**/tasks');

    await expect(page.locator(`text=${taskTitle}`)).toBeVisible({ timeout: 10_000 });
    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    await expect(taskCard.locator('text=Overdue')).toBeVisible();
  });
});
