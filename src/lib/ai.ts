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
      const parsed = JSON.parse(jsonMatch[0]);
      return { tasks: parsed.tasks ?? [], rawText: parsed.raw_text ?? '' };
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
