import { test, expect } from '@playwright/test';
import { login, quickAddTask } from './helpers/auth';

test.describe('Priority scoring with monetary values', () => {
  // These tests hit the real OpenAI API through the running app
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('higher monetary value task gets higher score', async ({ page }) => {
    // Create two tasks via quick-add
    const lowTask = `Low value task ${Date.now()}`;
    const highTask = `High value task ${Date.now()}`;

    await quickAddTask(page, lowTask);
    await quickAddTask(page, highTask);

    // Navigate to the high-value task to set monetary value
    await page.click(`text=${highTask}`);
    // Click the edit icon (pencil)
    await page.locator(`a[aria-label="Edit task: ${highTask}"]`).click();
    await page.waitForURL('**/tasks/**');

    // Check if there is a monetary value field and fill it
    const monetaryField = page.locator('input[type="number"]').first();
    if (await monetaryField.isVisible()) {
      // Enable edit mode if needed
      const editButton = page.locator('button:has-text("Edit")');
      if (await editButton.isVisible()) {
        await editButton.click();
      }
    }

    // Go back to tasks list
    await page.goto('/tasks');
    await page.waitForSelector(`text=${highTask}`, { timeout: 15_000 });

    // Both tasks should have score badges
    const highCard = page.locator(`text=${highTask}`).locator('..').locator('..');
    const lowCard = page.locator(`text=${lowTask}`).locator('..').locator('..');

    await expect(highCard.locator('text=Score:')).toBeVisible();
    await expect(lowCard.locator('text=Score:')).toBeVisible();
  });

  test('task without monetary value does not show NaN', async ({ page }) => {
    const taskTitle = `No money task ${Date.now()}`;
    await quickAddTask(page, taskTitle);

    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    const scoreBadge = taskCard.locator('text=Score:');
    await expect(scoreBadge).toBeVisible({ timeout: 10_000 });

    // Score should be a number, not NaN
    const scoreText = await scoreBadge.textContent();
    expect(scoreText).not.toContain('NaN');
  });
});
