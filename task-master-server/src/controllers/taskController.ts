import type { NextFunction, Request, Response } from 'express';
import * as taskService from '../services/tasks/taskService';
import type { CreateTaskInput, DeferOption, UpdateTaskInput } from '../types/task';

/** HTTP layer for task management. All handlers require an authenticated user. */

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : undefined;
    const includeCompleted = req.query.include_completed === 'true';
    const data = await taskService.listTasks(req.userId as string, { projectId, includeCompleted });
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await taskService.createTask(req.userId as string, req.body as CreateTaskInput);
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await taskService.updateTask(
      req.userId as string,
      req.params.id,
      req.body as UpdateTaskInput,
    );
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function complete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await taskService.completeTask(req.userId as string, req.params.id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function defer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { option } = req.body as { option: DeferOption };
    const data = await taskService.deferTask(req.userId as string, req.params.id, option);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await taskService.archiveTask(req.userId as string, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
