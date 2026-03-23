/**
 * Real integration tests for image extraction via Gemini API.
 * These tests hit the actual Google Gemini API — no mocks.
 * Uses ONE API call for the main test to conserve quota.
 * Requires GOOGLE_API_KEY in .env.local and CI secrets.
 * Tests FAIL if the key is missing — never skip.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { extractTasksFromImage, type ExtractedTask } from '../../src/lib/ai';
import fs from 'fs';
import path from 'path';

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'test-tasks.png');

describe('extractTasksFromImage (real Gemini API)', () => {
  let result: { tasks: ExtractedTask[]; rawText: string };

  beforeAll(async () => {
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is required. Set it in .env.local or CI secrets.');
    }
    // Single API call shared across all assertions
    const imageBuffer = fs.readFileSync(FIXTURE_PATH);
    const base64 = imageBuffer.toString('base64');
    result = await extractTasksFromImage(base64, 'image/png');
  }, 30_000);

  it('extracts at least 3 tasks from the test image', () => {
    expect(result.tasks.length).toBeGreaterThanOrEqual(3);
  });

  it('each task has title and valid confidence', () => {
    for (const task of result.tasks) {
      expect(task.title).toBeTruthy();
      expect(typeof task.title).toBe('string');
      expect(task.confidence).toBeGreaterThanOrEqual(0.5);
      expect(task.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  it('extracted tasks match expected content from the test image', () => {
    const allTitles = result.tasks.map((t) => t.title.toLowerCase()).join(' ');
    expect(allTitles).toMatch(/groceries|dentist|budget|invoice|flight|conference/i);
  });

  it('raw text is non-empty', () => {
    expect(result.rawText.length).toBeGreaterThan(0);
  });
});
