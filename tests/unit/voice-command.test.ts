import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

// Mock OpenAI for unit tests
vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  },
}));

import { parseVoiceCommand, type TaskContext } from '../../src/lib/ai';

beforeEach(() => {
  mockCreate.mockReset();
});

const sampleTasks: TaskContext[] = [
  { id: 1, title: 'Buy groceries', status: 'todo', priorityScore: 30, monetaryValue: null, revenuePotential: null, urgency: 3, strategicValue: null },
  { id: 2, title: 'Send invoice to client', status: 'todo', priorityScore: 75, monetaryValue: 5000, revenuePotential: null, urgency: 8, strategicValue: null },
  { id: 3, title: 'Call the dentist', status: 'done', priorityScore: 20, monetaryValue: null, revenuePotential: null, urgency: 2, strategicValue: null },
];

describe('parseVoiceCommand', () => {
  it('parses a single add_task intent', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            actions: [{
              type: 'add_task',
              taskTitle: 'Schedule meeting with John',
              fields: { title: 'Schedule meeting with John', urgency: 5 },
              confidence: 0.95,
            }],
            summary: 'Adding a new task: Schedule meeting with John',
          }),
        },
      }],
    });

    const result = await parseVoiceCommand('Add a task to schedule a meeting with John', sampleTasks);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('add_task');
    expect(result.actions[0].fields?.title).toBe('Schedule meeting with John');
    expect(result.summary).toContain('Schedule meeting');
  });

  it('parses a mark_done intent with task matching', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            actions: [{
              type: 'mark_done',
              taskId: 1,
              taskTitle: 'Buy groceries',
              confidence: 0.9,
            }],
            summary: 'Marking "Buy groceries" as done',
          }),
        },
      }],
    });

    const result = await parseVoiceCommand('Mark the groceries task as done', sampleTasks);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('mark_done');
    expect(result.actions[0].taskId).toBe(1);
  });

  it('parses multi-action commands', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            actions: [
              { type: 'add_task', taskTitle: 'Walk the dog', fields: { title: 'Walk the dog' }, confidence: 0.95 },
              { type: 'mark_done', taskId: 1, taskTitle: 'Buy groceries', confidence: 0.9 },
            ],
            summary: 'Adding "Walk the dog" and marking "Buy groceries" as done',
          }),
        },
      }],
    });

    const result = await parseVoiceCommand('Add walk the dog and mark groceries as done', sampleTasks);
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].type).toBe('add_task');
    expect(result.actions[1].type).toBe('mark_done');
  });

  it('parses a query intent', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            actions: [{
              type: 'query',
              queryResponse: 'Your most important task is "Send invoice to client" with a priority score of 75.',
              confidence: 1.0,
            }],
            summary: 'Answering a question about tasks',
          }),
        },
      }],
    });

    const result = await parseVoiceCommand("What's my most important task?", sampleTasks);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('query');
    expect(result.actions[0].queryResponse).toContain('Send invoice');
  });

  it('parses a reprioritize intent with monetary value', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            actions: [{
              type: 'reprioritize',
              taskId: 2,
              taskTitle: 'Send invoice to client',
              fields: { monetaryValue: 10000 },
              confidence: 0.85,
            }],
            summary: 'Updating "Send invoice to client" monetary value to $10,000',
          }),
        },
      }],
    });

    const result = await parseVoiceCommand('The invoice task is actually worth ten thousand dollars', sampleTasks);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('reprioritize');
    expect(result.actions[0].taskId).toBe(2);
    expect(result.actions[0].fields?.monetaryValue).toBe(10000);
  });

  it('handles malformed AI response gracefully', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'This is not valid JSON at all' } }],
    });

    const result = await parseVoiceCommand('Do something', sampleTasks);
    expect(result.actions).toEqual([]);
    expect(result.summary).toBe('Could not understand the command.');
  });

  it('handles JSON embedded in markdown code block', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: '```json\n{"actions": [{"type": "add_task", "taskTitle": "Test", "fields": {"title": "Test"}, "confidence": 0.9}], "summary": "Adding Test"}\n```',
        },
      }],
    });

    const result = await parseVoiceCommand('Add test', sampleTasks);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('add_task');
  });

  it('returns empty actions when API returns empty choices', async () => {
    mockCreate.mockResolvedValue({ choices: [] });

    const result = await parseVoiceCommand('Hello', sampleTasks);
    expect(result.actions).toEqual([]);
  });
});
