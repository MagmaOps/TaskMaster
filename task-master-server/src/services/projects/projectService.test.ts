/** Unit tests for projectService with the repository mocked. */
import * as projectRepo from '../../repositories/projectRepository';
import { createProject, updateProject, reorderProjects } from './projectService';
import { ApiError } from '../../utils/errors';

jest.mock('../../repositories/projectRepository');
const mocked = jest.mocked(projectRepo);

describe('projectService (unit)', () => {
  it('rejects creating a 21st project', async () => {
    mocked.countForUser.mockResolvedValue(20);
    await expect(createProject('u1', { name: 'X' })).rejects.toThrow(ApiError);
    expect(mocked.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate name on create (case-insensitive handled by repo lookup)', async () => {
    mocked.countForUser.mockResolvedValue(1);
    mocked.findByNameForUser.mockResolvedValue({ id: 'p1' } as never);
    await expect(createProject('u1', { name: 'work' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects renaming to another project’s name', async () => {
    mocked.findByIdForUser.mockResolvedValue({ id: 'p1' } as never);
    mocked.findByNameForUser.mockResolvedValue({ id: 'p2' } as never);
    await expect(updateProject('u1', 'p1', { name: 'Taken' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('rejects a reorder whose id set does not match the user’s projects', async () => {
    mocked.listForUser.mockResolvedValue([
      { id: 'p1', priority_order: 1 },
      { id: 'p2', priority_order: 2 },
    ]);
    // Missing p2, includes unknown p9.
    await expect(reorderProjects('u1', ['p1', 'p9'])).rejects.toMatchObject({ statusCode: 400 });
    expect(mocked.reorder).not.toHaveBeenCalled();
  });
});
