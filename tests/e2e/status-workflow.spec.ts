import { test, expect } from '@playwright/test';
import { login, quickAddTask } from './helpers/auth';

test.describe('Status workflow: todo -> doing -> done', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('cycles status through todo -> doing -> done and stays done', async ({ page }) => {
    const taskTitle = `Status test ${Date.now()}`;
    await quickAddTask(page, taskTitle);

    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    const statusBtn = taskCard.locator('button').first();

    // Click 1: todo -> doing
    await statusBtn.click();
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

    // Click 3: done stays done (no cycle back to todo)
    const statusBtn3 = cardAfterDone.locator('button').first();
    await statusBtn3.click();
    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForSelector(`text=${taskTitle}`, { timeout: 15_000 });
    const cardStillDone = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    await expect(cardStillDone.locator('.bg-green-500').first()).toBeVisible({ timeout: 5000 });
  });

  test('sets Waiting status via detail page and shows in Waiting section', async ({ page }) => {
    const taskTitle = `Waiting test ${Date.now()}`;
    await quickAddTask(page, taskTitle);

    // Navigate to task detail
    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    await taskCard.locator('a[aria-label^="Edit task"]').click();
    await page.waitForURL(/\/tasks\/\d+/, { timeout: 10_000 });

    // Click the "Waiting" status button
    await page.click('button:has-text("Waiting")');
    await page.waitForTimeout(1000);

    // Go back to task list
    await page.click('a[aria-label="Back to tasks"]');
    await page.waitForSelector(`text=${taskTitle}`, { timeout: 15_000 });

    // Task should appear under "Waiting" section with purple icon
    const waitingSection = page.locator('text=WAITING').locator('..');
    await expect(waitingSection).toBeVisible();
    const waitingCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    await expect(waitingCard.locator('.bg-purple-500').first()).toBeVisible({ timeout: 5000 });

    // Waiting filter should show the task
    await page.click('button[role="tab"]:has-text("Waiting")');
    await page.waitForTimeout(500);
    await expect(page.locator(`text=${taskTitle}`)).toBeVisible();

    // Clicking status icon on a waiting task should resume to doing
    const statusBtn = waitingCard.locator('button').first();
    await statusBtn.click();
    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForSelector(`text=${taskTitle}`, { timeout: 15_000 });
    const cardAfterResume = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    await expect(cardAfterResume.locator('.bg-amber-500').first()).toBeVisible({ timeout: 5000 });
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
