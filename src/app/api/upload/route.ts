import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { uploads, tasks } from '@/lib/db/schema';
import { extractTasksFromImage } from '@/lib/ai';
import { calculatePriorityAI } from '@/lib/priority';
import { logger } from '@/lib/logger';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_TASKS_PER_UPLOAD = 50;
const AI_SCORING_CONCURRENCY = 5;

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id);
    logger.info('POST /api/upload', { userId });

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Unsupported file type. Use JPG, PNG, WEBP, or HEIC.' }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum 10MB.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    const mimeType = file.type || 'image/jpeg';

    const { tasks: extractedTasks, rawText } = await extractTasksFromImage(base64, mimeType);
    const cappedTasks = extractedTasks.slice(0, MAX_TASKS_PER_UPLOAD);
    if (extractedTasks.length > MAX_TASKS_PER_UPLOAD) {
      logger.warn('Extracted tasks capped', { userId, extracted: extractedTasks.length, cap: MAX_TASKS_PER_UPLOAD });
    }
    logger.info('Tasks extracted from image', { userId, count: cappedTasks.length });

    const [upload] = await db
      .insert(uploads)
      .values({ userId, extractedText: rawText })
      .returning();

    // Score tasks via AI with concurrency limit
    const taskValues = [];
    for (let i = 0; i < cappedTasks.length; i += AI_SCORING_CONCURRENCY) {
      const batch = cappedTasks.slice(i, i + AI_SCORING_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (item) => {
          const { score, reason } = await calculatePriorityAI({ title: item.title });
          return {
            userId,
            title: item.title,
            sourceType: 'image_upload' as const,
            confidence: item.confidence,
            priorityScore: score,
            priorityReason: reason,
          };
        })
      );
      taskValues.push(...results);
    }

    const createdTasks = taskValues.length > 0
      ? await db.insert(tasks).values(taskValues).returning()
      : [];

    logger.info('Upload complete', { uploadId: upload.id, tasksCreated: createdTasks.length });
    return NextResponse.json({ uploadId: upload.id, tasks: createdTasks });
  } catch (err) {
    logger.error('POST /api/upload failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
