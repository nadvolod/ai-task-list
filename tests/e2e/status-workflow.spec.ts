import { test, expect } from '@playwright/test';
import { login, quickAddTask } from './helpers/auth';

test.describe('Status workflow: todo -> doing -> done', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('cycles status through todo -> doing -> done -> todo with server round-trip', async ({ page }) => {
    const taskTitle = `Status test ${Date.now()}`;
    await quickAddTask(page, taskTitle);

    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    const statusBtn = taskCard.locator('button').first();

    // Click 1: todo -> doing
    await statusBtn.click();
    // Wait for PATCH to complete, then reload to verify server state
    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForSelector(`text=${taskTitle}`, { timeout: 15_000 });
    const cardAfterDoing = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    await expect(cardAfterDoing.locator('.bg-amber-500').first()).toBeVisible({ timeout: 5000 });
    await expect(cardAfterDoing.locator('text=In Progress')).toBeVisible();

    // Click 2: doing -> done
    const statusBtn2 = cardAfterDoing.locator('button').first();
    await statusBtn2.click();
    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForSelector(`text=${taskTitle}`, { timeout: 15_000 });
    const cardAfterDone = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    await expect(cardAfterDone.locator('.bg-green-500').first()).toBeVisible({ timeout: 5000 });

    // Click 3: done -> todo
    const statusBtn3 = cardAfterDone.locator('button').first();
    await statusBtn3.click();
    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForSelector(`text=${taskTitle}`, { timeout: 15_000 });
    const cardAfterTodo = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    await expect(cardAfterTodo.locator('.bg-green-500')).not.toBeVisible();
    await expect(cardAfterTodo.locator('.bg-amber-500')).not.toBeVisible();
  });

  test('In Progress filter shows doing tasks and hides todo tasks', async ({ page }) => {
    // Create two tasks
    const doingTask = `Doing task ${Date.now()}`;
    const todoTask = `Todo task ${Date.now()}`;
    await quickAddTask(page, doingTask);
    await quickAddTask(page, todoTask);

    // Set first task to doing
    const doingCard = page.locator(`text=${doingTask}`).locator('..').locator('..');
    await doingCard.locator('button').first().click();
    await page.waitForTimeout(1000);

    // Click "In Progress" filter
    await page.click('button:has-text("In Progress")');
    await page.waitForTimeout(500);

    // Doing task should be visible, todo task should not
    await expect(page.locator(`text=${doingTask}`)).toBeVisible();
    await expect(page.locator(`text=${todoTask}`)).not.toBeVisible();
  });
});
