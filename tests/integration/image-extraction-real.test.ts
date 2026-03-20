/**
 * Real integration tests for image extraction via Gemini API.
 * These tests hit the actual Google Gemini API — no mocks.
 * Requires GOOGLE_API_KEY to be set in .env.local.
 */
import { describe, it, expect } from 'vitest';
import { extractTasksFromImage } from '../../src/lib/ai';
import fs from 'fs';
import path from 'path';

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'test-tasks.png');

describe('extractTasksFromImage (real Gemini API)', () => {
  it('extracts tasks from a PNG image with a to-do list', async () => {
    const imageBuffer = fs.readFileSync(FIXTURE_PATH);
    const base64 = imageBuffer.toString('base64');

    const result = await extractTasksFromImage(base64, 'image/png');

    expect(result).toHaveProperty('tasks');
    expect(result).toHaveProperty('rawText');
    expect(Array.isArray(result.tasks)).toBe(true);

    // The test image has 5 tasks — Gemini should extract at least 3
    expect(result.tasks.length).toBeGreaterThanOrEqual(3);

    // Each task should have title and confidence
    for (const task of result.tasks) {
      expect(task.title).toBeTruthy();
      expect(typeof task.title).toBe('string');
      expect(task.confidence).toBeGreaterThanOrEqual(0.5);
      expect(task.confidence).toBeLessThanOrEqual(1.0);
    }

    // Verify the extracted tasks match expected content (fuzzy — AI may rephrase slightly)
    const allTitles = result.tasks.map((t) => t.title.toLowerCase()).join(' ');
    expect(allTitles).toMatch(/groceries|dentist|budget|invoice|flight|conference/i);

    // Raw text should contain some of the original text
    expect(result.rawText.length).toBeGreaterThan(0);
  }, 30_000);

  it('returns empty tasks for a blank image', async () => {
    // Create a minimal 1x1 white PNG
    const sharp = (await import('sharp')).default;
    const blankPng = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const base64 = blankPng.toString('base64');
    const result = await extractTasksFromImage(base64, 'image/png');

    expect(result).toHaveProperty('tasks');
    expect(Array.isArray(result.tasks)).toBe(true);
    // A blank image should yield no tasks (or very few false positives)
    expect(result.tasks.length).toBeLessThanOrEqual(1);
  }, 30_000);
});
