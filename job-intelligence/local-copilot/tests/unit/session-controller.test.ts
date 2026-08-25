import { describe, expect, it } from 'vitest';

import {
  SessionController,
  type SessionEvent,
} from '../../src/main/sessions/session-controller';

function createController() {
  const controllers: AbortController[] = [];
  const controller = new SessionController({
    createAbortController: () => {
      const abortController = new AbortController();
      controllers.push(abortController);
      return abortController;
    },
  });

  return { controller, controllers };
}

async function nextEvent(events: AsyncIterator<SessionEvent>): Promise<SessionEvent> {
  const result = await events.next();
  if (result.done) {
    throw new Error('Expected a session event.');
  }
  return result.value;
}

describe('SessionController', () => {
  it('ignores a duplicate start without allocating a second capture lifecycle', () => {
    const { controller, controllers } = createController();

    expect(controller.dispatch({ type: 'start' })).toMatchObject({ phase: 'capturing', captureLifecycle: 1 });
    expect(controller.dispatch({ type: 'start' })).toMatchObject({ phase: 'capturing', captureLifecycle: 1 });

    expect(controllers).toHaveLength(1);
    expect(controllers[0]?.signal.aborted).toBe(false);
  });

  it('pauses and resumes the same capture lifecycle', () => {
    const { controller, controllers } = createController();
    controller.dispatch({ type: 'start' });

    expect(controller.dispatch({ type: 'pause' })).toMatchObject({ phase: 'paused', captureLifecycle: 1 });
    expect(controller.dispatch({ type: 'resume' })).toMatchObject({ phase: 'capturing', captureLifecycle: 1 });

    expect(controllers).toHaveLength(1);
    expect(controllers[0]?.signal.aborted).toBe(false);
  });

  it('aborts an active generation before starting its replacement', () => {
    const { controller, controllers } = createController();
    controller.dispatch({ type: 'start' });
    controller.dispatch({ type: 'generate', requestId: 'first' });

    expect(controller.dispatch({ type: 'generate', requestId: 'second' })).toMatchObject({
      phase: 'generating',
      generation: { lifecycle: 2, requestId: 'second' },
    });

    expect(controllers).toHaveLength(3);
    expect(controllers[1]?.signal.aborted).toBe(true);
    expect(controllers[2]?.signal.aborted).toBe(false);
  });

  it('stops cleanly from an error state', () => {
    const { controller, controllers } = createController();
    controller.dispatch({ type: 'start' });
    controller.dispatch({ type: 'utility-process-crashed', message: 'audio worker exited' });

    expect(controller.dispatch({ type: 'stop' })).toMatchObject({
      phase: 'stopped',
      error: null,
      pendingBufferBytes: 0,
    });
    expect(controllers[0]?.signal.aborted).toBe(true);
  });

  it('moves an active session to error and cancels live work when the utility process crashes', () => {
    const { controller, controllers } = createController();
    controller.dispatch({ type: 'start' });
    controller.dispatch({ type: 'buffer-pending', bytes: new Uint8Array([1, 2, 3]) });
    controller.dispatch({ type: 'generate', requestId: 'question-1' });

    expect(controller.dispatch({ type: 'utility-process-crashed', message: 'audio worker exited' })).toMatchObject({
      phase: 'error',
      error: { code: 'UTILITY_PROCESS_CRASHED', message: 'audio worker exited' },
      generation: null,
      pendingBufferBytes: 0,
    });
    expect(controllers.map(({ signal }) => signal.aborted)).toEqual([true, true]);
  });

  it('clears pending in-memory buffers and emits exactly one terminal event', async () => {
    const { controller } = createController();
    const events = controller.events()[Symbol.asyncIterator]();
    controller.dispatch({ type: 'start' });
    controller.dispatch({ type: 'buffer-pending', bytes: new Uint8Array([1, 2, 3]) });

    expect(controller.dispatch({ type: 'stop' })).toMatchObject({ phase: 'stopped', pendingBufferBytes: 0 });
    controller.dispatch({ type: 'stop' });

    const observed: SessionEvent[] = [];
    for (let index = 0; index < 3; index += 1) {
      observed.push(await nextEvent(events));
    }

    expect(observed.filter((event) => event.type === 'session-ended')).toEqual([
      expect.objectContaining({ type: 'session-ended', reason: 'stopped' }),
    ]);
    await events.return?.();
  });
});
