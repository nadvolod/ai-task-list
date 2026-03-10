import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { uploads, tasks } from '@/lib/db/schema';
import { extractTasksFromImage } from '@/lib/ai';
import { calculatePriority } from '@/lib/priority';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);

  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  // Convert file to base64 for OpenAI Vision API
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString('base64');
  const mimeType = file.type || 'image/jpeg';

  // Extract tasks using AI
  const { tasks: extractedTasks, rawText } = await extractTasksFromImage(base64, mimeType);

  // Store upload record
  const [upload] = await db
    .insert(uploads)
    .values({ userId, extractedText: rawText })
    .returning();

  // Create task records for each extracted item
  const createdTasks = [];
  for (const item of extractedTasks) {
    const { score, reason } = calculatePriority({});
    const [task] = await db
      .insert(tasks)
      .values({
        userId,
        title: item.title,
        sourceType: 'image_upload',
        confidence: item.confidence,
        priorityScore: score,
        priorityReason: reason,
      })
      .returning();
    createdTasks.push(task);
  }

  return NextResponse.json({ uploadId: upload.id, tasks: createdTasks });
}
