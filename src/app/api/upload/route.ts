import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { uploads, tasks } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { extractTasksFromImage } from '@/lib/ai';
import { reprioritizeAllTasks } from '@/lib/priority';
import { logger } from '@/lib/logger';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_TASKS_PER_UPLOAD = 50;

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

    // Two-pass insert: parent tasks first, then subtasks with parentId linking
    const allCreatedIds: number[] = [];
    let subtaskCount = 0;

    // Pass 1: Insert parent/top-level tasks
    for (const item of cappedTasks) {
      const dueDate = item.due_date ? new Date(item.due_date) : null;
      const [parent] = await db.insert(tasks).values({
        userId,
        title: item.title,
        sourceType: 'image_upload' as const,
        confidence: item.confidence,
        dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : null,
        recurrenceRule: item.recurrence_rule ?? null,
        recurrenceDays: item.recurrence_days ?? null,
      }).returning();
      allCreatedIds.push(parent.id);

      // Pass 2: Insert subtasks for this parent
      if (item.subtasks && item.subtasks.length > 0) {
        for (let i = 0; i < item.subtasks.length; i++) {
          const sub = item.subtasks[i];
          const [child] = await db.insert(tasks).values({
            userId,
            title: sub.title,
            sourceType: 'image_upload' as const,
            confidence: sub.confidence,
            parentId: parent.id,
            subtaskOrder: i,
            recurrenceRule: item.recurrence_rule ?? null,
            recurrenceDays: item.recurrence_days ?? null,
          }).returning();
          allCreatedIds.push(child.id);
          subtaskCount++;
        }
      }
    }

    // Re-rank all tasks relative to each other (including the new ones)
    if (allCreatedIds.length > 0) {
      await reprioritizeAllTasks(userId);
    }

    // Re-fetch to get updated priority scores
    const updatedTasks = allCreatedIds.length > 0
      ? await db.select().from(tasks).where(
          and(eq(tasks.userId, userId), inArray(tasks.id, allCreatedIds))
        )
      : [];

    logger.info('Upload complete', { uploadId: upload.id, tasksCreated: updatedTasks.length, subtasks: subtaskCount });
    return NextResponse.json({ uploadId: upload.id, tasks: updatedTasks, subtaskCount });
  } catch (err) {
    logger.error('POST /api/upload failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
