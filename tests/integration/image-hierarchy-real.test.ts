/**
 * Real Gemini API tests for hierarchical task extraction from images.
 * Validates that Gemini correctly detects parent tasks and subtasks
 * from indented/bulleted list images.
 *
 * These tests call the REAL Google Gemini API — no mocks.
 * Requires GOOGLE_API_KEY in .env.local.
 * Skipped in CI when the key is not available.
 */
import { describe, it, expect } from 'vitest';
import { extractTasksFromImage } from '../../src/lib/ai';
import sharp from 'sharp';

const hasGoogleKey = !!process.env.GOOGLE_API_KEY;

/**
 * Generate a PNG image containing hierarchical text (parent tasks + indented subtasks).
 * Uses sharp's text-to-image via SVG overlay.
 */
async function createHierarchicalTaskImage(): Promise<string> {
  const svgText = `
    <svg width="600" height="500" xmlns="http://www.w3.org/2000/svg">
      <rect width="600" height="500" fill="white"/>
      <text x="30" y="40" font-family="Arial" font-size="24" font-weight="bold" fill="black">Project Tasks</text>
      <line x1="30" y1="50" x2="570" y2="50" stroke="black" stroke-width="1"/>

      <text x="30" y="85" font-family="Arial" font-size="18" font-weight="bold" fill="black">Nexus Tutorial</text>
      <text x="60" y="110" font-family="Arial" font-size="14" fill="#333">- Write draft content</text>
      <text x="60" y="132" font-family="Arial" font-size="14" fill="#333">- Record video walkthrough</text>
      <text x="60" y="154" font-family="Arial" font-size="14" fill="#333">- Review documentation updates</text>

      <text x="30" y="190" font-family="Arial" font-size="18" font-weight="bold" fill="black">Marketing Campaign</text>
      <text x="60" y="215" font-family="Arial" font-size="14" fill="#333">- Design landing page</text>
      <text x="60" y="237" font-family="Arial" font-size="14" fill="#333">- Write email copy</text>

      <text x="30" y="275" font-family="Arial" font-size="18" font-weight="bold" fill="black">Schedule dentist appointment</text>

      <text x="30" y="315" font-family="Arial" font-size="18" font-weight="bold" fill="black">Weekly Team Sync (every Monday)</text>
      <text x="60" y="340" font-family="Arial" font-size="14" fill="#333">- Prepare status update</text>
      <text x="60" y="362" font-family="Arial" font-size="14" fill="#333">- Collect team blockers</text>
    </svg>`;

  const pngBuffer = await sharp(Buffer.from(svgText))
    .png()
    .toBuffer();

  return pngBuffer.toString('base64');
}

describe.skipIf(!hasGoogleKey)('extractTasksFromImage — hierarchy detection (real Gemini API)', () => {
  it('extracts parent tasks with subtasks from a hierarchical list image', async () => {
    const base64 = await createHierarchicalTaskImage();
    const result = await extractTasksFromImage(base64, 'image/png');

    expect(result).toHaveProperty('tasks');
    expect(Array.isArray(result.tasks)).toBe(true);

    // Should extract at least 3 parent-level tasks
    expect(result.tasks.length).toBeGreaterThanOrEqual(3);

    // Find the Nexus Tutorial parent — should have subtasks
    const nexus = result.tasks.find(t =>
      t.title.toLowerCase().includes('nexus')
    );
    expect(nexus).toBeDefined();
    expect(nexus!.subtasks).toBeDefined();
    expect(nexus!.subtasks!.length).toBeGreaterThanOrEqual(2);

    // Subtasks should mention write/record/review
    const subtaskTitles = nexus!.subtasks!.map(s => s.title.toLowerCase()).join(' ');
    expect(subtaskTitles).toMatch(/write|draft|record|video|review|documentation/i);

    // Find the Marketing Campaign — should also have subtasks
    const marketing = result.tasks.find(t =>
      t.title.toLowerCase().includes('marketing')
    );
    expect(marketing).toBeDefined();
    expect(marketing!.subtasks).toBeDefined();
    expect(marketing!.subtasks!.length).toBeGreaterThanOrEqual(1);

    // "Schedule dentist appointment" should be a standalone task with no subtasks
    const dentist = result.tasks.find(t =>
      t.title.toLowerCase().includes('dentist')
    );
    expect(dentist).toBeDefined();
    expect(dentist!.subtasks?.length ?? 0).toBe(0);
  }, 45_000);

  it('detects recurrence patterns in task text', async () => {
    const base64 = await createHierarchicalTaskImage();
    const result = await extractTasksFromImage(base64, 'image/png');

    // The "Weekly Team Sync (every Monday)" task should have recurrence_rule
    const weekly = result.tasks.find(t =>
      t.title.toLowerCase().includes('team sync') ||
      t.title.toLowerCase().includes('weekly')
    );
    expect(weekly).toBeDefined();
    expect(weekly!.recurrence_rule).toBe('weekly');

    // Non-recurring tasks should not have recurrence_rule
    const dentist = result.tasks.find(t =>
      t.title.toLowerCase().includes('dentist')
    );
    if (dentist) {
      expect(dentist.recurrence_rule).toBeFalsy();
    }
  }, 45_000);

  it('each extracted task has title and confidence', async () => {
    const base64 = await createHierarchicalTaskImage();
    const result = await extractTasksFromImage(base64, 'image/png');

    for (const task of result.tasks) {
      expect(task.title).toBeTruthy();
      expect(typeof task.title).toBe('string');
      expect(task.confidence).toBeGreaterThanOrEqual(0.5);
      expect(task.confidence).toBeLessThanOrEqual(1.0);

      // Subtasks should also have title and confidence
      if (task.subtasks) {
        for (const sub of task.subtasks) {
          expect(sub.title).toBeTruthy();
          expect(sub.confidence).toBeGreaterThanOrEqual(0.5);
        }
      }
    }
  }, 45_000);
});
