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

export type VoiceIntent =
  | { intent: 'create_tasks'; tasks: VoiceCapturedTask[] }
  | { intent: 'complete_task'; task_query: string }
  | { intent: 'start_task'; task_query: string }
  | { intent: 'update_task'; task_query: string; updates: { title?: string; status?: 'todo' | 'doing' | 'done'; due_date?: string; urgency?: number; strategic_value?: number; monetary_value?: number; revenue_potential?: number; description?: string; assignee?: string; priority_override?: number; priority_reason?: string; recurrence_rule?: string; recurrence_days?: string; category?: string } }
  | { intent: 'delete_task'; task_query: string }
  | { intent: 'delete_all_tasks' }
  | { intent: 'query_briefing' }
  | { intent: 'query_tasks'; filter?: 'all' | 'overdue' | 'today' | 'high_priority' | 'done' }
  | { intent: 'query_count'; filter?: 'all' | 'overdue' | 'today' | 'high_priority' | 'done' }
  | { intent: 'undo_complete'; task_query: string }
  | { intent: 'unknown'; raw_text: string };

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

  const taskListContext = existingTaskTitles.length > 0
    ? `\nThe user's current tasks are:\n${existingTaskTitles.map((t, i) => `${i + 1}. "${t}"`).join('\n')}`
    : '\nThe user has no tasks yet.';

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 800,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: `You are a voice command router for a CEO's task management app. Classify the user's spoken input into one of these intents and return ONLY valid JSON.

Today's date is ${new Date().toISOString().split('T')[0]}.
${taskListContext}

INTENTS:

1. create_tasks — User wants to add new tasks
   {"intent":"create_tasks","tasks":[{"title":"...","description":"...","monetary_value":N,"revenue_potential":N,"urgency":1-10,"strategic_value":1-10,"due_date":"YYYY-MM-DD"}]}

2. complete_task — User wants to mark a task as done
   {"intent":"complete_task","task_query":"search string to match task title"}

3. update_task — User wants to change a task's details (due date, urgency, assignee, priority, recurrence, etc.)
   {"intent":"update_task","task_query":"search string","updates":{"due_date":"YYYY-MM-DD","urgency":N,"assignee":"person name","priority_override":0-100,"priority_reason":"why","recurrence_rule":"weekly","recurrence_days":"1,3",...}}

4. delete_task — User wants to remove a specific task
   {"intent":"delete_task","task_query":"search string to match task title"}

5. delete_all_tasks — User wants to remove ALL tasks ("delete all", "clear everything", "remove all my tasks")
   {"intent":"delete_all_tasks"}

6. query_briefing — User asks what to focus on, what's important, a summary
   {"intent":"query_briefing"}

7. query_tasks — User wants to hear their tasks (optionally filtered)
   {"intent":"query_tasks","filter":"all|overdue|today|high_priority|done"}

8. query_count — User asks how many tasks they have
   {"intent":"query_count","filter":"all|overdue|today|high_priority|done"}

9. undo_complete — User wants to reopen a completed task
   {"intent":"undo_complete","task_query":"search string"}

10. start_task — User is working on a task ("I'm working on X", "started X", "X is in progress")
   {"intent":"start_task","task_query":"search string"}

11. unknown — Can't determine intent
   {"intent":"unknown","raw_text":"original text"}

MATCHING RULES:
- For task_query, use the most distinctive words from the user's speech to match against their task list above
- "the Acme deal" → task_query: "Acme deal"
- "mark it done" without specifying which task → ask by returning unknown with helpful raw_text
- If the user says something that could be a new task OR a command, prefer the command interpretation if it matches an existing task
- "by Friday" "next week" "tomorrow" → convert to ISO dates for due_date
- Multiple new tasks in one utterance → create_tasks with multiple items in the array
- "assign X to Y" or "Y is responsible for X" → update_task with updates.assignee
- "make X my top priority" or "X is the most important" → update_task with priority_override: 95, priority_reason explaining why
- "make X recurring every Monday" → update_task with recurrence_rule: "weekly", recurrence_days: "1"
- "this should be higher priority because..." → update_task with priority_override and priority_reason
- "categorize X as Temporal" or "this is a Temporal task" → update_task with category
- "I'm working on X" or "I started X" or "X is in progress" → start_task
- "pause X" or "stop working on X" → update_task with updates.status: "todo"
- Priority override scale: 95-100 = top priority, 70-90 = high, 40-60 = medium, 10-30 = low
- ONLY set due_date when the user explicitly mentions a deadline or time constraint. Do NOT infer today's date. "I need to call John" → due_date: null. "Call John by Friday" → due_date: next Friday.
- If no assignee is mentioned, leave assignee as null (the system defaults to the current user)`,
      },
      {
        role: 'user',
        content: text,
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? '{}';
  let intent: VoiceIntent;

  try {
    intent = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { intent = JSON.parse(jsonMatch[0]); } catch { intent = { intent: 'unknown', raw_text: text }; }
    } else {
      intent = { intent: 'unknown', raw_text: text };
    }
  }

  return { transcription: text, intent };
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
  "assignee": "person name" or null
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
- Interpret "urgent"/"ASAP" as urgency 8-9
- Interpret relative dates: "tomorrow", "Friday", "next week", "end of month"
- ONLY set due_date when the user explicitly mentions a deadline or time constraint. Do NOT infer today's date. "I need to call John" → due_date: null. "Call John by Friday" → due_date: next Friday.
- If no assignee is mentioned, leave assignee as null (the system defaults to the current user)
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
