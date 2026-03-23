import { test, expect } from '@playwright/test';
import { login, quickAddTask } from './helpers/auth';

test.beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for E2E scoring tests.');
  }
});

test.describe('Priority scoring with monetary values', () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('higher monetary value task gets higher score after editing', async ({ page }) => {
    // Create two tasks
    const lowTask = `Low value ${Date.now()}`;
    const highTask = `High value ${Date.now()}`;
    await quickAddTask(page, lowTask);
    await quickAddTask(page, highTask);

    // Edit high-value task to add $500K monetary value
    await page.locator(`a[aria-label="Edit task: ${highTask}"]`).click();
    await page.waitForURL('**/tasks/**');

    // Click edit button if present
    const editButton = page.locator('button:has-text("Edit")');
    if (await editButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editButton.click();
    }

    // Find and fill monetary value field
    const monetaryInput = page.locator('label:has-text("Monetary") + input, label:has-text("monetary") ~ input').first();
    await monetaryInput.fill('500000');
    // Submit
    await page.locator('button:has-text("Save")').click();

    // Wait for reprioritization and go back to task list
    await page.waitForTimeout(3000);
    await page.goto('/tasks');
    await page.waitForSelector(`text=${highTask}`, { timeout: 15_000 });

    // Extract scores
    const highCard = page.locator(`text=${highTask}`).locator('..').locator('..');
    const lowCard = page.locator(`text=${lowTask}`).locator('..').locator('..');

    const highScoreText = await highCard.locator('text=Score:').textContent();
    const lowScoreText = await lowCard.locator('text=Score:').textContent();

    const highScore = parseInt(highScoreText?.match(/\d+/)?.[0] ?? '0');
    const lowScore = parseInt(lowScoreText?.match(/\d+/)?.[0] ?? '0');

    expect(highScore).toBeGreaterThan(lowScore);
  });

  test('task without monetary value does not show NaN', async ({ page }) => {
    const taskTitle = `No money ${Date.now()}`;
    await quickAddTask(page, taskTitle);

    const taskCard = page.locator(`text=${taskTitle}`).locator('..').locator('..');
    const scoreBadge = taskCard.locator('text=Score:');
    await expect(scoreBadge).toBeVisible({ timeout: 10_000 });

    const scoreText = await scoreBadge.textContent();
    expect(scoreText).not.toContain('NaN');
  });
});
