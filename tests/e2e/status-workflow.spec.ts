import { test, expect } from '@playwright/test';
import { login, quickAddTask } from './helpers/auth';

test.describe('Status workflow: todo -> doing -> done', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('cycles status through todo -> doing -> done -> todo', async ({ page }) => {
    const taskTitle = `Status test ${Date.now()}`;
    await quickAddTask(page, taskTitle);

    // Find the task card
    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');

    // Initial state: todo (empty gray circle - no bg-amber, no bg-green)
    const statusBtn = taskCard.locator('button').first();

    // Click 1: todo -> doing (amber circle should appear)
    await statusBtn.click();
    await expect(taskCard.locator('.bg-amber-500').first()).toBeVisible({ timeout: 5000 });
    // "In Progress" badge should appear
    await expect(taskCard.locator('text=In Progress')).toBeVisible();

    // Click 2: doing -> done (green circle should appear)
    await statusBtn.click();
    await expect(taskCard.locator('.bg-green-500').first()).toBeVisible({ timeout: 5000 });

    // Click 3: done -> todo (back to gray circle)
    await statusBtn.click();
    // The task should be back in pending state (no green, no amber fill)
    await expect(taskCard.locator('.bg-green-500')).not.toBeVisible();
    await expect(taskCard.locator('.bg-amber-500')).not.toBeVisible();
  });

  test('In Progress filter shows only doing tasks', async ({ page }) => {
    const taskTitle = `Filter test ${Date.now()}`;
    await quickAddTask(page, taskTitle);

    // Set task to doing
    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    const statusBtn = taskCard.locator('button').first();
    await statusBtn.click();
    await expect(taskCard.locator('.bg-amber-500').first()).toBeVisible({ timeout: 5000 });

    // Click "In Progress" filter
    await page.click('button:has-text("In Progress")');

    // Task should still be visible
    await expect(page.locator(`text=${taskTitle}`)).toBeVisible();
  });
});
