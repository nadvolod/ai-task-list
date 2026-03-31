import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize OpenAI client (lazy, so server-side only)
function getClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Initialize Google Gemini client (lazy, for image extraction)
function getGeminiClient() {
  return new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
}

/**
 * Extract task list items from an image using Google Gemini vision.
 * Returns an array of task strings.
 */
export interface ExtractedTask {
  title: string;
  confidence: number;
  subtasks?: Array<{ title: string; confidence: number }>;
  recurrence_rule?: string;
  recurrence_days?: string;
  due_date?: string;
  category?: string;
}

export async function extractTasksFromImage(
  base64Image: string,
  mimeType: string
): Promise<{ tasks: ExtractedTask[]; rawText: string }> {
  const gemini = getGeminiClient();
  const model = gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const today = new Date().toISOString().split('T')[0];
  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: base64Image,
      },
    },
    {
      text: `Extract the to-do list items from this image. Return ONLY a JSON object with this exact structure:
{
  "raw_text": "the full extracted text",
  "tasks": [
    {
      "title": "Task description",
      "confidence": 0.9,
      "subtasks": [
        { "title": "Sub-item description", "confidence": 0.9 }
      ],
      "recurrence_rule": "weekly",
      "recurrence_days": "1",
      "due_date": "YYYY-MM-DD"
    }
  ]
}
Rules:
- Each top-level task should be a separate item.
- Detect hierarchy: indented items, bullet sub-items, or numbered sub-lists are SUBTASKS of the parent item above them.
- Parent tasks (headers, non-indented, bold, or colon-terminated items) contain their subtasks in a "subtasks" array.
- Items without subtasks should have an empty "subtasks" array or omit the field.
- Only support one level of nesting (subtasks cannot have their own subtasks).
- Detect recurring task patterns. Look for words like "every", "weekly", "daily", "monthly", "each Monday", "recurring", etc.
- If a task is recurring, set recurrence_rule to one of: "daily", "weekly", "biweekly", "monthly". Otherwise omit it.
- For weekly tasks on specific days, set recurrence_days as comma-separated ISO weekday numbers (1=Mon through 7=Sun).
- If a task is recurring and no explicit due date, set due_date to the next occurrence from today (${today}).
- If a group of tasks share recurrence context (e.g., a list titled "Weekly Tasks"), apply that recurrence to all tasks.
- Detect task categories/projects from context. If tasks are grouped under a heading like "Temporal", "Marketing", "Personal", set the "category" field. If the image has a title or header suggesting a project/company, apply that category to all tasks.
- Preserve the user's wording as closely as possible.
- Clean up obvious OCR noise (stray characters, garbled words).
- Do not add tasks that are not in the image.
- Set confidence between 0.5 and 1.0. Use lower confidence if the text is hard to read.
- Return valid JSON only, no markdown.`,
    },
  ]);

  const content = result.response.text() ?? '{"raw_text":"","tasks":[]}';

  try {
    const parsed = JSON.parse(content);
    return {
      tasks: parsed.tasks ?? [],
      rawText: parsed.raw_text ?? '',
    };
  } catch {
    // Fallback: try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return { tasks: parsed.tasks ?? [], rawText: parsed.raw_text ?? '' };
      } catch {
        return { tasks: [], rawText: content };
      }
    }
    return { tasks: [], rawText: content };
  }
}

export interface VoiceParsedMetadata {
  monetary_value?: number;
  revenue_potential?: number;
  urgency?: number;
  strategic_value?: number;
  effort_estimate?: string;
  notes?: string;
  due_date?: string;
}

/**
 * Transcribe audio using Whisper and then parse it into structured task metadata.
 */
export async function transcribeAndParseVoice(
  audioBuffer: Buffer,
  filename: string,
  taskTitle: string
): Promise<{ transcription: string; metadata: VoiceParsedMetadata }> {
  const client = getClient();

  // Step 1: Transcribe audio using Whisper
  const transcription = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file: new File([new Uint8Array(audioBuffer)], filename, { type: 'audio/webm' }),
    response_format: 'text',
  });

  const text = typeof transcription === 'string' ? transcription : (transcription as { text: string }).text;

  // Step 2: Parse transcription into structured metadata
  const parseResponse = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 300,
    messages: [
      {
        role: 'system',
        content: `You extract structured priority metadata from voice notes about tasks. 
Return ONLY valid JSON with these optional fields:
{
  "monetary_value": number or null,   // dollar amount mentioned (protect or earn)
  "revenue_potential": number or null, // potential revenue in dollars
  "urgency": number or null,          // 1-10 scale
  "strategic_value": number or null,  // 1-10 scale
  "effort_estimate": string or null,  // e.g. "2 hours", "1 day"
  "notes": string or null,            // brief summary of the voice note
  "due_date": string or null          // ISO date string if a deadline is mentioned
}
Today's date is ${new Date().toISOString().split('T')[0]}.
Interpret context clues:
- "urgent" or "ASAP" → urgency 8-9
- "can generate revenue" or "new business" → revenue_potential 5000 if no amount specified
- "worth X dollars" → monetary_value = X
- "no monetary value" → monetary_value = 0, revenue_potential = 0
- "strategic" or "long-term" → strategic_value 7-8
- "by Friday", "next week", "end of month", "tomorrow" → due_date as ISO date string
- ONLY set due_date when the user explicitly mentions a deadline. Do NOT infer today's date just because the user says "I need to" or "I should".`,
      },
      {
        role: 'user',
        content: `Task: "${taskTitle}"\nVoice note: "${text}"`,
      },
    ],
  });

  const metaContent = parseResponse.choices[0]?.message?.content ?? '{}';
  let metadata: VoiceParsedMetadata = {};

  try {
    metadata = JSON.parse(metaContent);
  } catch {
    const jsonMatch = metaContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { metadata = JSON.parse(jsonMatch[0]); } catch (innerErr) { console.error('Voice metadata parse error:', innerErr); }
    }
  }

  return { transcription: text, metadata };
}

// ─── Voice Command System ───

export interface TaskUpdateFields {
  title?: string;
  status?: 'todo' | 'doing' | 'waiting' | 'done';
  due_date?: string;
  urgency?: number;
  strategic_value?: number;
  monetary_value?: number;
  revenue_potential?: number;
  description?: string;
  assignee?: string;
  priority_override?: number;
  priority_reason?: string;
  recurrence_rule?: string;
  recurrence_days?: string;
  category?: string;
}

export type VoiceIntentBase =
  | { intent: 'create_tasks'; tasks: VoiceCapturedTask[] }
  | { intent: 'complete_task'; task_query: string }
  | { intent: 'start_task'; task_query: string }
  | { intent: 'update_task'; task_query: string; updates: TaskUpdateFields }
  | { intent: 'batch_update'; updates: Array<{ task_query: string; updates: TaskUpdateFields; subtasks?: Array<{ title: string; description?: string }> }> }
  | { intent: 'delete_task'; task_query: string }
  | { intent: 'delete_all_tasks' }
  | { intent: 'query_briefing' }
  | { intent: 'query_tasks'; filter?: 'all' | 'overdue' | 'today' | 'high_priority' | 'done' }
  | { intent: 'query_count'; filter?: 'all' | 'overdue' | 'today' | 'high_priority' | 'done' }
  | { intent: 'undo_complete'; task_query: string }
  | { intent: 'unknown'; raw_text: string };

export type VoiceIntent = VoiceIntentBase & {
  needs_confirmation?: boolean;
  ambiguities?: string[];
};

function buildClassificationPrompt(existingTaskTitles: string[], currentDate?: string): string {
  const taskListContext = existingTaskTitles.length > 0
    ? `\nThe user's current tasks are:\n${existingTaskTitles.map((t, i) => `${i + 1}. "${t}"`).join('\n')}`
    : '\nThe user has no tasks yet.';

  return `You are a voice command router for a CEO's task management app. Classify the user's spoken input into one of these intents and return ONLY valid JSON.

Today's date is ${currentDate ?? new Date().toISOString().split('T')[0]}.
${taskListContext}

INTENTS:

1. create_tasks — User wants to add new tasks
   {"intent":"create_tasks","tasks":[{"title":"...","description":"...","monetary_value":N,"revenue_potential":N,"urgency":1-10,"strategic_value":1-10,"due_date":"YYYY-MM-DD"}]}

2. complete_task — User wants to mark a task as done
   {"intent":"complete_task","task_query":"search string to match task title"}

3. update_task — User wants to change a SINGLE task's details (due date, urgency, assignee, priority, recurrence, etc.)
   {"intent":"update_task","task_query":"search string","updates":{"due_date":"YYYY-MM-DD","urgency":N,"assignee":"person name","priority_override":0-100,"priority_reason":"why","recurrence_rule":"weekly","recurrence_days":"1,3",...}}

4. batch_update — User mentions updates to MULTIPLE existing tasks in one utterance
   {"intent":"batch_update","updates":[
     {"task_query":"search string for task 1","updates":{"description":"context from speech","priority_override":N,"priority_reason":"why",...},"subtasks":[{"title":"actionable follow-up","description":"context"}]},
     {"task_query":"search string for task 2","updates":{"due_date":"YYYY-MM-DD","description":"context",...}}
   ]}
   Use this when the user references 2 or more EXISTING tasks from their task list in one utterance.
   Each entry follows the same update fields as update_task.
   Always include a "description" field summarizing what the user said about that task (status update, what happened, what's pending).
   Add "subtasks" array when the user mentions specific actionable follow-up items for a task.

5. delete_task — User wants to remove a specific task
   {"intent":"delete_task","task_query":"search string to match task title"}

6. delete_all_tasks — User wants to remove ALL tasks ("delete all", "clear everything", "remove all my tasks")
   {"intent":"delete_all_tasks"}

7. query_briefing — User asks what to focus on, what's important, a summary
   {"intent":"query_briefing"}

8. query_tasks — User wants to hear their tasks (optionally filtered)
   {"intent":"query_tasks","filter":"all|overdue|today|high_priority|done"}

9. query_count — User asks how many tasks they have
   {"intent":"query_count","filter":"all|overdue|today|high_priority|done"}

10. undo_complete — User wants to reopen a completed task
   {"intent":"undo_complete","task_query":"search string"}

11. start_task — User is working on a task ("I'm working on X", "started X", "X is in progress")
   {"intent":"start_task","task_query":"search string"}

12. unknown — Can't determine intent
   {"intent":"unknown","raw_text":"original text"}

MATCHING RULES:
- For task_query, use the most distinctive words from the user's speech to match against their task list above
- "the Acme deal" → task_query: "Acme deal"
- "mark it done" without specifying which task → ask by returning unknown with helpful raw_text
- If the user says something that could be a new task OR a command, prefer the command interpretation if it matches an existing task
- "by Friday" "next week" "tomorrow" → convert to ISO dates for due_date
- Multiple new tasks in one utterance → create_tasks with multiple items in the array
- If the user provides status updates on 2 or more EXISTING tasks in one utterance → batch_update. Each task's updates should include a "description" summarizing what the user said, plus priority_override/due_date/status if mentioned. Example: "On the Flagler sale, I emailed revisions. For Art's contract, make it top priority." → batch_update with 2 entries.
- "assign X to Y" or "Y is responsible for X" → update_task with updates.assignee
- "make X my top priority" or "X is the most important" → update_task with priority_override: 95, priority_reason explaining why
- "make X recurring every Monday" → update_task with recurrence_rule: "weekly", recurrence_days: "1"
- "this should be higher priority because..." → update_task with priority_override and priority_reason
- "categorize X as Temporal" or "this is a Temporal task" → update_task with category
- "I'm working on X" or "I started X" or "X is in progress" → start_task
- "pause X" or "stop working on X" → update_task with updates.status: "todo"
- "waiting on X" or "X is blocked" or "X depends on someone" → update_task with updates.status: "waiting"
- Priority override scale: 95-100 = top priority, 70-90 = high, 40-60 = medium, 10-30 = low
- ONLY set due_date when the user explicitly mentions a deadline or time constraint. Do NOT infer today's date. "I need to call John" → due_date: null. "Call John by Friday" → due_date: next Friday.
- If no assignee is mentioned, omit the assignee field entirely (the system defaults to the current user)
- Self-corrections: If the user corrects themselves ("no wait", "actually", "I mean"), use ONLY the corrected version. Ignore the false start entirely.
- Negation: Pay careful attention to negation. "Don't assign it to me" means the speaker is NOT the assignee — assign to the other person mentioned. "Not high priority" means low priority (urgency 2-3). "Don't create a task" → return unknown with raw_text.
- Subtask disambiguation: When the user says "with subtasks", uses a colon followed by a list, or says "which involves" → create ONE parent task with a subtasks array. When items are clearly independent ("and also", separate sentences about unrelated work) → create separate top-level tasks in create_tasks.
- Priority inference: Infer urgency from context phrases. "blocking launch"/"critical"/"showstopper" → urgency 9-10. "ASAP"/"urgent" → urgency 8-9. "important"/"high priority" → urgency 7-8. "nice to have"/"not a rush"/"low priority" → urgency 2-3.
- Relative dates: "end of month" → last calendar day of current month. "end of week" → Friday of current week. "in N days" → today + N calendar days. "next [weekday]" → the upcoming occurrence of that weekday AFTER today.

CLARIFICATION RULES:
- Add "needs_confirmation": true and "ambiguities": ["description of ambiguity"] to your JSON response when:
  - The referenced task is ambiguous (multiple tasks could match)
  - The owner/assignee is unclear (multiple people mentioned without clear assignment)
  - The due date has multiple valid interpretations
  - The user contradicts themselves and the final intent is unclear
  - Critical information is missing and the utterance is too vague to act on
- Set "needs_confirmation": false (or omit) when the intent and fields are clear
- Keep ambiguity descriptions short and specific, e.g. "unclear which task: 'budget' matches 2 tasks"
- Do NOT flag ambiguity for optional missing fields (priority, category). Only flag for critical fields: intent, task reference, owner, due date.`;
}

function parseIntentResponse(content: string, fallbackText: string): VoiceIntent {
  try {
    return JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch { return { intent: 'unknown', raw_text: fallbackText }; }
    }
    return { intent: 'unknown', raw_text: fallbackText };
  }
}

/**
 * Classify pre-transcribed text into a VoiceIntent.
 * Used by real API tests to test classification without audio transcription.
 */
export async function classifyTextIntent(
  text: string,
  existingTaskTitles: string[],
  currentDate?: string
): Promise<VoiceIntent> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2000,
    temperature: 0.1,
    messages: [
      { role: 'system', content: buildClassificationPrompt(existingTaskTitles, currentDate) },
      { role: 'user', content: text },
    ],
  });
  const content = response.choices[0]?.message?.content ?? '{}';
  return parseIntentResponse(content, text);
}

/**
 * Transcribe audio and classify the CEO's intent.
 * Returns the transcription and a structured intent object.
 */
export async function transcribeAndClassifyIntent(
  audioBuffer: Buffer,
  filename: string,
  existingTaskTitles: string[]
): Promise<{ transcription: string; intent: VoiceIntent }> {
  const client = getClient();

  const transcription = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file: new File([new Uint8Array(audioBuffer)], filename, { type: 'audio/webm' }),
    response_format: 'text',
  });

  const text = typeof transcription === 'string' ? transcription : (transcription as { text: string }).text;

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2000,
    temperature: 0.1,
    messages: [
      { role: 'system', content: buildClassificationPrompt(existingTaskTitles) },
      { role: 'user', content: text },
    ],
  });

  const content = response.choices[0]?.message?.content ?? '{}';
  const intent = parseIntentResponse(content, text);

  return { transcription: text, intent };
}

const CATEGORIES = ['Health', 'Finance', 'Work', 'Business', 'Family', 'Friends', 'Spiritual', 'Fun'] as const;

/**
 * Auto-categorize a task by title and description using AI.
 * Returns one of the predefined categories or null if classification fails.
 */
export async function autoCategorizeTask(title: string, description?: string | null): Promise<string | null> {
  try {
    const client = getClient();
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 50,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `Classify the task into exactly ONE of these categories: ${CATEGORIES.join(', ')}. Return ONLY the category name, nothing else.`,
        },
        {
          role: 'user',
          content: description ? `${title} — ${description}` : title,
        },
      ],
    });
    const category = response.choices[0]?.message?.content?.trim() ?? '';
    return CATEGORIES.includes(category as typeof CATEGORIES[number]) ? category : null;
  } catch {
    return null;
  }
}

/**
 * Generate a spoken response for the CEO using TTS.
 */
export async function generateSpeech(text: string): Promise<Buffer> {
  const client = getClient();
  const response = await client.audio.speech.create({
    model: 'tts-1',
    voice: 'onyx',
    input: text,
    response_format: 'mp3',
  });
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export interface VoiceCapturedTask {
  title: string;
  description?: string;
  monetary_value?: number;
  revenue_potential?: number;
  urgency?: number;
  strategic_value?: number;
  due_date?: string;
  subtasks?: Array<{ title: string; description?: string }>;
  recurrence_rule?: string;
  recurrence_days?: string;
  assignee?: string;
  category?: string;
  project?: string;
  confidence?: number;
}

/**
 * Transcribe audio and extract one or more complete tasks from natural speech.
 * Used by the voice-first quick capture feature.
 */
export async function transcribeAndCreateTasks(
  audioBuffer: Buffer,
  filename: string
): Promise<{ transcription: string; tasks: VoiceCapturedTask[] }> {
  const client = getClient();

  const transcription = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file: new File([new Uint8Array(audioBuffer)], filename, { type: 'audio/webm' }),
    response_format: 'text',
  });

  const text = typeof transcription === 'string' ? transcription : (transcription as { text: string }).text;

  const parseResponse = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1000,
    messages: [
      {
        role: 'system',
        content: `You extract tasks from natural speech by a busy CEO. Return ONLY valid JSON array of tasks:
[{
  "title": "concise task title",
  "description": "any additional context mentioned" or null,
  "monetary_value": number or null,
  "revenue_potential": number or null,
  "urgency": 1-10 or null,
  "strategic_value": 1-10 or null,
  "due_date": "YYYY-MM-DD" or null,
  "subtasks": [{"title": "sub-item title", "description": "context"}] or null,
  "recurrence_rule": "daily"|"weekly"|"biweekly"|"monthly" or null,
  "recurrence_days": "1,3,5" or null,
  "assignee": "person name" or null,
  "category": "department or area" or null,
  "project": "specific initiative name" or null,
  "confidence": 0.0-1.0
}]

Today's date is ${new Date().toISOString().split('T')[0]}.

Rules:
- Split multiple tasks mentioned in one utterance into separate items
- "Call John about the 500K deal, it's urgent, due Friday" → one task with title, monetary_value=500000, urgency=8, due_date=next Friday
- "I need to review the Q3 budget and also schedule the board meeting for next month" → two separate tasks
- If user mentions sub-items ("which involves A, B, and C" or "I need to do X: first A, then B, then C"), structure as parent task with subtasks array
- Detect recurring patterns: "every Monday", "weekly standup", "daily check-in" → set recurrence_rule and recurrence_days (1=Mon..7=Sun)
- "assign this to Sarah" or "Sarah needs to handle this" → set assignee
- Detect project/category context: "for Temporal", "this is a marketing task", "personal errand" → set category
- Detect project names: "for the WHO RFP", "part of Q3 launch", "under the migration project" → set project (distinct from category)
- Set confidence (0-1): 1.0 for clear/unambiguous speech, 0.7-0.9 for mostly clear with minor inference, 0.3-0.6 for significant interpretation, below 0.3 for highly ambiguous
- Interpret "urgent"/"ASAP" as urgency 8-9
- Interpret relative dates: "tomorrow", "Friday", "next week", "end of month"
- ONLY set due_date when the user explicitly mentions a deadline or time constraint. Do NOT infer today's date. "I need to call John" → due_date: null. "Call John by Friday" → due_date: next Friday.
- If no assignee is mentioned, omit the assignee field entirely (the system defaults to the current user)
- Keep titles concise and actionable
- Return valid JSON array only, no markdown`,
      },
      {
        role: 'user',
        content: text,
      },
    ],
  });

  const content = parseResponse.choices[0]?.message?.content ?? '[]';
  let parsedTasks: VoiceCapturedTask[] = [];

  try {
    parsedTasks = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try { parsedTasks = JSON.parse(jsonMatch[0]); } catch { parsedTasks = []; }
    }
  }

  if (!Array.isArray(parsedTasks) || parsedTasks.length === 0) {
    parsedTasks = [{ title: text.substring(0, 200) }];
  }

  return { transcription: text, tasks: parsedTasks };
}
