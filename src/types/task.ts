export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: 'todo' | 'doing' | 'done';
  priorityScore: number;
  priorityReason: string | null;
  monetaryValue: number | null;
  revenuePotential: number | null;
  revenueType: string | null;
  urgency: number | null;
  strategicValue: number | null;
  confidence: number | null;
  sourceType: string;
  dueDate: string | null;
  // Subtask support (Issue #10)
  parentId: number | null;
  subtaskOrder: number | null;
  // Recurrence support (Issue #9)
  recurrenceRule: string | null;
  recurrenceDays: string | null;
  recurrenceEndDate: string | null;
  recurrenceParentId: number | null;
  recurrenceActive: string | null;
  // Category & project (Issue #13, #22)
  category: string | null;
  project: string | null;
  // Assignee & priority override (Issue #11)
  assignee: string | null;
  manualPriorityScore: number | null;
  manualPriorityReason: string | null;
}
