import type { NextFunction, Request, Response } from 'express';
import * as projectService from '../services/projects/projectService';
import type { CreateProjectInput, UpdateProjectInput } from '../types/project';

/** HTTP layer for projects. All handlers require an authenticated user. */

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await projectService.listProjects(req.userId as string);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await projectService.createProject(req.userId as string, req.body as CreateProjectInput);
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function reorder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { projectIds } = req.body as { projectIds: string[] };
    const data = await projectService.reorderProjects(req.userId as string, projectIds);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await projectService.updateProject(
      req.userId as string,
      req.params.id,
      req.body as UpdateProjectInput,
    );
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await projectService.deleteProject(req.userId as string, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
