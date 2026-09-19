/** Project domain types. */

export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  priority_order: number;
  color: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProjectWithCount extends ProjectRow {
  task_count: number;
}

export interface ProjectDTO {
  id: string;
  name: string;
  priorityOrder: number;
  color: string | null;
  taskCount: number;
  createdAt: string;
}

export interface CreateProjectInput {
  name: string;
  color?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  color?: string | null;
}
