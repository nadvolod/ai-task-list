import OpenAI from 'openai';

// Initialize OpenAI client (lazy, so server-side only)
function getClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Extract task list items from an image using GPT-4o vision.
 * Returns an array of task strings.
 */
export async function extractTasksFromImage(
  base64Image: string,
  mimeType: string
): Promise<{ tasks: Array<{ title: string; confidence: number }>; rawText: string }> {
  const client = getClient();

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Image}` },
          },
          {
            type: 'text',
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
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? '{"raw_text":"","tasks":[]}';

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
}

/**
 * Transcribe audio using Whisper. Standalone helper reused by voice notes and voice commands.
 */
export async function transcribeAudio(audioBuffer: Buffer, filename: string): Promise<string> {
  const client = getClient();
  const transcription = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file: new File([new Uint8Array(audioBuffer)], filename, { type: 'audio/webm' }),
    response_format: 'text',
  });
  return typeof transcription === 'string' ? transcription : (transcription as { text: string }).text;
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

  const text = await transcribeAudio(audioBuffer, filename);

  // Parse transcription into structured metadata
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
  "notes": string or null             // brief summary of the voice note
}
Interpret context clues:
- "urgent" or "ASAP" → urgency 8-9
- "can generate revenue" or "new business" → revenue_potential 5000 if no amount specified
- "worth X dollars" → monetary_value = X
- "no monetary value" → monetary_value = 0, revenue_potential = 0
- "strategic" or "long-term" → strategic_value 7-8`,
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

// --- Voice Command Types ---

export interface VoiceCommandAction {
  type: 'add_task' | 'update_task' | 'mark_done' | 'mark_undone' | 'reprioritize' | 'delete_task' | 'query';
  taskId?: number;
  taskTitle?: string;
  fields?: {
    title?: string;
    description?: string;
    monetaryValue?: number;
    revenuePotential?: number;
    urgency?: number;
    strategicValue?: number;
  };
  queryResponse?: string;
  confidence: number;
}

export interface VoiceCommandResult {
  transcription: string;
  actions: VoiceCommandAction[];
  summary: string;
}

export interface TaskContext {
  id: number;
  title: string;
  status: string;
  priorityScore: number;
  monetaryValue: number | null;
  revenuePotential: number | null;
  urgency: number | null;
  strategicValue: number | null;
}

/**
 * Parse a voice command transcription against the user's task list.
 * Uses GPT-4o for multi-intent reasoning and fuzzy task name matching.
 */
export async function parseVoiceCommand(
  transcription: string,
  currentTasks: TaskContext[]
): Promise<VoiceCommandResult> {
  const client = getClient();

  // Cap task list context to 50 tasks
  const taskContext = currentTasks.slice(0, 50).map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priorityScore: Math.round(t.priorityScore),
    monetaryValue: t.monetaryValue,
    urgency: t.urgency,
  }));

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1000,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: `You are a task management voice assistant. The user speaks commands about their tasks. Parse the command into structured actions.

The user's current task list:
${JSON.stringify(taskContext, null, 2)}

Return ONLY valid JSON with this structure:
{
  "actions": [
    {
      "type": "add_task" | "update_task" | "mark_done" | "mark_undone" | "reprioritize" | "delete_task" | "query",
      "taskId": number (required for existing task actions, match by fuzzy title),
      "taskTitle": "string (the task title for add_task, or matched title for context)",
      "fields": {
        "title": "string (for add_task)",
        "description": "string (optional notes)",
        "monetaryValue": number (optional, dollars),
        "revenuePotential": number (optional, dollars),
        "urgency": number (optional, 1-10),
        "strategicValue": number (optional, 1-10)
      },
      "queryResponse": "string (natural language answer for query type)",
      "confidence": number (0-1, how confident you are in matching the intent/task)
    }
  ],
  "summary": "Brief human-readable description of what was understood"
}

Rules:
- Support multiple actions in one command ("add X and mark Y as done")
- For existing tasks, match by fuzzy title and return the taskId from the list
- "mark done" / "complete" / "finish" → mark_done
- "undo" / "reopen" / "mark not done" → mark_undone
- "add" / "create" / "new task" → add_task with fields.title
- "reprioritize" / "make higher/lower priority" / "it's worth $X" → reprioritize with fields
- "delete" / "remove" → delete_task
- Questions ("what's my top task?", "how many tasks?") → query with queryResponse
- If urgency is mentioned ("urgent", "ASAP") set fields.urgency to 8-9
- If money is mentioned ("worth $5000") set fields.monetaryValue
- If no task matches, still return the action with confidence < 0.5 and a reasonable taskTitle
- Always set confidence based on how sure you are about the match`,
      },
      {
        role: 'user',
        content: transcription,
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? '{}';

  let parsed: { actions?: VoiceCommandAction[]; summary?: string };
  try {
    parsed = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        parsed = {};
      }
    } else {
      parsed = {};
    }
  }

  return {
    transcription,
    actions: parsed.actions ?? [],
    summary: parsed.summary ?? 'Could not understand the command.',
  };
}
