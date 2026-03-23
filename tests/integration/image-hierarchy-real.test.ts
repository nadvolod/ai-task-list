/**
 * Real Gemini API test for hierarchical task extraction from images.
 * Validates that Gemini correctly detects parent tasks, subtasks,
 * recurrence, and confidence from a single API call.
 *
 * Uses ONE Gemini API call to conserve quota.
 * Requires GOOGLE_API_KEY in .env.local and CI secrets.
 * Tests FAIL if the key is missing — never skip.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { extractTasksFromImage, type ExtractedTask } from '../../src/lib/ai';
import sharp from 'sharp';

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

  const pngBuffer = await sharp(Buffer.from(svgText)).png().toBuffer();
  return pngBuffer.toString('base64');
}

describe('extractTasksFromImage — hierarchy detection (real Gemini API)', () => {
  let result: { tasks: ExtractedTask[]; rawText: string };

  beforeAll(async () => {
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is required. Set it in .env.local or CI secrets.');
    }
    // Single API call shared across all assertions
    const base64 = await createHierarchicalTaskImage();
    result = await extractTasksFromImage(base64, 'image/png');
  }, 45_000);

  it('extracts at least 3 parent-level tasks', () => {
    expect(result.tasks.length).toBeGreaterThanOrEqual(3);
  });

  it('detects subtasks under Nexus Tutorial', () => {
    const nexus = result.tasks.find(t => t.title.toLowerCase().includes('nexus'));
    expect(nexus).toBeDefined();
    expect(nexus!.subtasks).toBeDefined();
    expect(nexus!.subtasks!.length).toBeGreaterThanOrEqual(2);
    const subtaskTitles = nexus!.subtasks!.map(s => s.title.toLowerCase()).join(' ');
    expect(subtaskTitles).toMatch(/write|draft|record|video|review|documentation/i);
  });

  it('detects subtasks under Marketing Campaign', () => {
    const marketing = result.tasks.find(t => t.title.toLowerCase().includes('marketing'));
    expect(marketing).toBeDefined();
    expect(marketing!.subtasks).toBeDefined();
    expect(marketing!.subtasks!.length).toBeGreaterThanOrEqual(1);
  });

  it('standalone task has no subtasks', () => {
    const dentist = result.tasks.find(t => t.title.toLowerCase().includes('dentist'));
    expect(dentist).toBeDefined();
    expect(dentist!.subtasks?.length ?? 0).toBe(0);
  });

  it('detects recurrence in "Weekly Team Sync (every Monday)"', () => {
    const weekly = result.tasks.find(t =>
      t.title.toLowerCase().includes('team sync') || t.title.toLowerCase().includes('weekly')
    );
    expect(weekly).toBeDefined();
    expect(weekly!.recurrence_rule).toBe('weekly');
  });

  it('non-recurring tasks have no recurrence_rule', () => {
    const dentist = result.tasks.find(t => t.title.toLowerCase().includes('dentist'));
    if (dentist) {
      expect(dentist.recurrence_rule).toBeFalsy();
    }
  });

  it('all tasks have title and valid confidence', () => {
    for (const task of result.tasks) {
      expect(task.title).toBeTruthy();
      expect(task.confidence).toBeGreaterThanOrEqual(0.5);
      expect(task.confidence).toBeLessThanOrEqual(1.0);
      if (task.subtasks) {
        for (const sub of task.subtasks) {
          expect(sub.title).toBeTruthy();
          expect(sub.confidence).toBeGreaterThanOrEqual(0.5);
        }
      }
    }
  });
});
