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
    logger.info('Tasks extracted from image', { userId, count: extractedTasks.length });

    const [upload] = await db
      .insert(uploads)
      .values({ userId, extractedText: rawText })
      .returning();

    // Score all tasks via AI and batch insert
    const taskValues = await Promise.all(
      extractedTasks.map(async (item) => {
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
