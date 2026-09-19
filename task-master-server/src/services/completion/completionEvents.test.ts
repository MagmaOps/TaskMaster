import {
  registerCompletionListener,
  clearCompletionListeners,
  emitTaskCompleted,
  type CompletionEvent,
} from './completionEvents';

function fakeEvent(): CompletionEvent {
  return {
    userId: 'u1',
    task: {} as never,
    weightAtCompletion: 42,
    unlocked: [],
  };
}

describe('completionEvents dispatcher', () => {
  beforeEach(() => clearCompletionListeners());

  it('invokes listeners in registration order', async () => {
    const calls: number[] = [];
    registerCompletionListener(async () => {
      calls.push(1);
    });
    registerCompletionListener(async () => {
      calls.push(2);
    });
    await emitTaskCompleted(fakeEvent());
    expect(calls).toEqual([1, 2]);
  });

  it('isolates a throwing listener and still runs the rest', async () => {
    const calls: string[] = [];
    registerCompletionListener(async () => {
      throw new Error('boom');
    });
    registerCompletionListener(async () => {
      calls.push('ran');
    });
    await expect(emitTaskCompleted(fakeEvent())).resolves.toBeUndefined();
    expect(calls).toEqual(['ran']);
  });

  it('clearCompletionListeners empties the registry', async () => {
    let ran = false;
    registerCompletionListener(async () => {
      ran = true;
    });
    clearCompletionListeners();
    await emitTaskCompleted(fakeEvent());
    expect(ran).toBe(false);
  });

  it('passes the same event to listeners so unlocked can be appended', async () => {
    registerCompletionListener(async (e) => {
      e.unlocked.push({ type: 'first_task_completed' });
    });
    const event = fakeEvent();
    await emitTaskCompleted(event);
    expect(event.unlocked).toEqual([{ type: 'first_task_completed' }]);
  });
});
