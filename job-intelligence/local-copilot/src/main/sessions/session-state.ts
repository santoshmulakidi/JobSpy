export const SESSION_PHASES = ['idle', 'capturing', 'paused', 'generating', 'error', 'stopped'] as const;

export type SessionPhase = (typeof SESSION_PHASES)[number];

export type SessionIntent =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'generate'; requestId: string }
  | { type: 'generation-completed'; requestId: string }
  | { type: 'generation-failed'; requestId: string; message: string }
  | { type: 'utility-process-crashed'; message: string }
  | { type: 'buffer-pending'; bytes: Uint8Array }
  | { type: 'stop' };

export interface StateTransition {
  readonly previous: SessionPhase;
  readonly next: SessionPhase;
  readonly accepted: boolean;
}

type TransitionRule = Record<SessionIntent['type'], SessionPhase | null>;

const TRANSITIONS: Record<SessionPhase, TransitionRule> = {
  idle: {
    start: 'capturing',
    pause: null,
    resume: null,
    generate: null,
    'generation-completed': null,
    'generation-failed': null,
    'utility-process-crashed': null,
    'buffer-pending': null,
    stop: null,
  },
  capturing: {
    start: null,
    pause: 'paused',
    resume: null,
    generate: 'generating',
    'generation-completed': null,
    'generation-failed': null,
    'utility-process-crashed': 'error',
    'buffer-pending': 'capturing',
    stop: 'stopped',
  },
  paused: {
    start: null,
    pause: null,
    resume: 'capturing',
    generate: null,
    'generation-completed': null,
    'generation-failed': null,
    'utility-process-crashed': 'error',
    'buffer-pending': null,
    stop: 'stopped',
  },
  generating: {
    start: null,
    pause: null,
    resume: null,
    generate: 'generating',
    'generation-completed': 'capturing',
    'generation-failed': 'error',
    'utility-process-crashed': 'error',
    'buffer-pending': 'generating',
    stop: 'stopped',
  },
  error: {
    start: null,
    pause: null,
    resume: null,
    generate: null,
    'generation-completed': null,
    'generation-failed': null,
    'utility-process-crashed': null,
    'buffer-pending': null,
    stop: 'stopped',
  },
  stopped: {
    start: null,
    pause: null,
    resume: null,
    generate: null,
    'generation-completed': null,
    'generation-failed': null,
    'utility-process-crashed': null,
    'buffer-pending': null,
    stop: null,
  },
};

/** Returns an explicit result for every approved phase/intent combination. */
export function transition(phase: SessionPhase, intent: SessionIntent): StateTransition {
  const next = TRANSITIONS[phase][intent.type];
  return {
    previous: phase,
    next: next ?? phase,
    accepted: next !== null,
  };
}
