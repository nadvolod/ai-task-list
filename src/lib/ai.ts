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
export async function extractTasksFromImage(
  base64Image: string,
  mimeType: string
): Promise<{ tasks: Array<{ title: string; confidence: number }>; rawText: string }> {
  const gemini = getGeminiClient();
  const model = gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });

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
    { "title": "Task description", "confidence": 0.9 }
  ]
}
Rules:
- Each task should be a separate item.
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
- "by Friday", "next week", "end of month", "tomorrow" → due_date as ISO date string`,
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
  | { intent: 'update_task'; task_query: string; updates: { title?: string; due_date?: string; urgency?: number; strategic_value?: number; monetary_value?: number; revenue_potential?: number; description?: string } }
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

3. update_task — User wants to change a task's details (due date, urgency, etc.)
   {"intent":"update_task","task_query":"search string","updates":{"due_date":"YYYY-MM-DD","urgency":N,...}}

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

10. unknown — Can't determine intent
   {"intent":"unknown","raw_text":"original text"}

MATCHING RULES:
- For task_query, use the most distinctive words from the user's speech to match against their task list above
- "the Acme deal" → task_query: "Acme deal"
- "mark it done" without specifying which task → ask by returning unknown with helpful raw_text
- If the user says something that could be a new task OR a command, prefer the command interpretation if it matches an existing task
- "by Friday" "next week" "tomorrow" → convert to ISO dates for due_date
- Multiple new tasks in one utterance → create_tasks with multiple items in the array`,
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
  "due_date": "YYYY-MM-DD" or null
}]

Today's date is ${new Date().toISOString().split('T')[0]}.

Rules:
- Split multiple tasks mentioned in one utterance into separate items
- "Call John about the 500K deal, it's urgent, due Friday" → one task with title, monetary_value=500000, urgency=8, due_date=next Friday
- "I need to review the Q3 budget and also schedule the board meeting for next month" → two separate tasks
- Interpret "urgent"/"ASAP" as urgency 8-9
- Interpret relative dates: "tomorrow", "Friday", "next week", "end of month"
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
