import {
  getAdvisorSubmissionPolicy,
  resolveAdvisorIntent,
} from "./stationAdvisorInput.js";

export const advisorInteractionRetryDelayMs = 900;

export const advisorInteractionPhase = Object.freeze({
  IDLE: "idle",
  STARTING: "starting",
  LISTENING: "listening",
  RECOGNIZING: "recognizing",
  RETRY_WAIT: "retry-wait",
  COUNTDOWN: "countdown",
  EDITING: "editing",
  CONFIRM_SENSITIVE: "confirm-sensitive",
  CONFIRM_LOW: "confirm-low",
  SUBMITTING: "submitting",
  AWAITING_RESPONSE: "awaiting-response",
  PAUSED: "paused",
  ERROR: "error",
});

export const advisorInteractionEffect = Object.freeze({
  START_RECOGNITION: "start-recognition",
  ABORT_RECOGNITION: "abort-recognition",
  SCHEDULE_RETRY: "schedule-retry",
  CANCEL_RETRY: "cancel-retry",
  SCHEDULE_AUTO_SUBMIT: "schedule-auto-submit",
  CANCEL_AUTO_SUBMIT: "cancel-auto-submit",
  SUBMIT: "submit",
});

export function createAdvisorInteractionState({ autoListenEnabled = true, draft = "" } = {}) {
  const initialDraft = String(draft || "");
  return {
    phase: initialDraft ? advisorInteractionPhase.EDITING : advisorInteractionPhase.IDLE,
    draft: initialDraft,
    draftRevision: initialDraft ? 1 : 0,
    source: initialDraft ? "keyboard" : null,
    autoListenEnabled: Boolean(autoListenEnabled),
    explicitlyPaused: false,
    keyboardFocused: false,
    turnPending: false,
    activeSessionId: null,
    sessionSequence: 0,
    retryToken: null,
    retrySequence: 0,
    countdownToken: null,
    countdownSequence: 0,
    activeSubmissionId: null,
    submissionSequence: 0,
    confirmationReason: null,
    lastError: "",
  };
}

function result(state, effects = []) {
  return { state, effects };
}

function cancellationEffects(state, { recognition = true, retry = true, countdown = true } = {}) {
  const effects = [];
  if (recognition && state.activeSessionId != null) {
    effects.push({ type: advisorInteractionEffect.ABORT_RECOGNITION, sessionId: state.activeSessionId });
  }
  if (retry && state.retryToken != null) {
    effects.push({ type: advisorInteractionEffect.CANCEL_RETRY, retryToken: state.retryToken });
  }
  if (countdown && state.countdownToken != null) {
    effects.push({ type: advisorInteractionEffect.CANCEL_AUTO_SUBMIT, countdownToken: state.countdownToken });
  }
  return effects;
}

function beginRecognition(state, reason) {
  const sessionId = state.sessionSequence + 1;
  return result({
    ...state,
    phase: advisorInteractionPhase.STARTING,
    activeSessionId: sessionId,
    sessionSequence: sessionId,
    retryToken: null,
    countdownToken: null,
    confirmationReason: null,
    lastError: "",
  }, [{ type: advisorInteractionEffect.START_RECOGNITION, sessionId, reason }]);
}

function canAutomaticallyListen(state) {
  return state.autoListenEnabled
    && !state.explicitlyPaused
    && !state.keyboardFocused
    && !state.turnPending
    && state.activeSubmissionId == null
    && state.activeSessionId == null
    && state.retryToken == null
    && state.countdownToken == null
    && !state.draft.trim();
}

function isCurrentRecognition(state, event) {
  return state.activeSessionId != null && event.sessionId === state.activeSessionId;
}

function beginSubmission(state, text, priorEffects = []) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText || state.activeSubmissionId != null || state.turnPending) return result(state);
  const submissionId = state.submissionSequence + 1;
  return result({
    ...state,
    phase: advisorInteractionPhase.SUBMITTING,
    activeSessionId: null,
    retryToken: null,
    countdownToken: null,
    activeSubmissionId: submissionId,
    submissionSequence: submissionId,
    confirmationReason: null,
    lastError: "",
  }, [
    ...priorEffects,
    {
      type: advisorInteractionEffect.SUBMIT,
      submissionId,
      text: normalizedText,
      intent: resolveAdvisorIntent(normalizedText),
    },
  ]);
}

function scheduleRecoverableRetry(state, message) {
  if (!state.autoListenEnabled || state.explicitlyPaused || state.keyboardFocused || state.turnPending) {
    return result({
      ...state,
      phase: state.explicitlyPaused ? advisorInteractionPhase.PAUSED : advisorInteractionPhase.IDLE,
      activeSessionId: null,
      lastError: String(message || ""),
    });
  }
  const retryToken = state.retrySequence + 1;
  return result({
    ...state,
    phase: advisorInteractionPhase.RETRY_WAIT,
    activeSessionId: null,
    retryToken,
    retrySequence: retryToken,
    lastError: String(message || "没有听到清晰语音"),
  }, [{
    type: advisorInteractionEffect.SCHEDULE_RETRY,
    retryToken,
    delayMs: advisorInteractionRetryDelayMs,
  }]);
}

/**
 * Pure interaction transition. The caller executes returned effects and feeds
 * completions back with their session, retry, countdown, or submission token.
 */
export function reduceAdvisorInteraction(state, event = {}) {
  if (!state) throw new TypeError("advisor interaction state is required");

  switch (event.type) {
    case "APP_READY": {
      if (!canAutomaticallyListen(state)) return result(state);
      return beginRecognition(state, "initial-auto-listen");
    }

    case "LISTENING_STARTED": {
      if (!isCurrentRecognition(state, event)) return result(state);
      return result({ ...state, phase: advisorInteractionPhase.LISTENING, lastError: "" });
    }

    case "RECOGNIZING_STARTED": {
      if (!isCurrentRecognition(state, event)) return result(state);
      return result({ ...state, phase: advisorInteractionPhase.RECOGNIZING });
    }

    case "NO_SPEECH": {
      if (!isCurrentRecognition(state, event)) return result(state);
      return scheduleRecoverableRetry(state, event.message || "没有听到清晰语音，请再说一次或直接输入");
    }

    case "RETRY_DUE": {
      if (event.retryToken == null || event.retryToken !== state.retryToken) return result(state);
      const cleared = { ...state, retryToken: null };
      if (!canAutomaticallyListen(cleared)) {
        return result({
          ...cleared,
          phase: cleared.explicitlyPaused
            ? advisorInteractionPhase.PAUSED
            : cleared.draft
              ? advisorInteractionPhase.EDITING
              : advisorInteractionPhase.IDLE,
        });
      }
      return beginRecognition(cleared, "recoverable-retry");
    }

    case "RECOGNITION_PARTIAL": {
      if (!isCurrentRecognition(state, event)) return result(state);
      if (![advisorInteractionPhase.STARTING, advisorInteractionPhase.LISTENING, advisorInteractionPhase.RECOGNIZING].includes(state.phase)) {
        return result(state);
      }
      const text = String(event.text || "").trim();
      if (!text || text === state.draft) return result(state);
      return result({
        ...state,
        draft: text,
        draftRevision: state.draftRevision + 1,
        source: "voice",
      });
    }

    case "RECOGNITION_FINAL": {
      if (!isCurrentRecognition(state, event)) return result(state);
      const text = String(event.text || "").trim();
      if (!text) return scheduleRecoverableRetry(state, "没有听清，请再说一次或直接输入");
      const draftRevision = state.draftRevision + 1;
      const base = {
        ...state,
        draft: text,
        draftRevision,
        source: "voice",
        activeSessionId: null,
        retryToken: null,
        countdownToken: null,
        confirmationReason: null,
        lastError: "",
      };
      const policy = getAdvisorSubmissionPolicy({
        text,
        confidence: event.confidence,
        provider: event.provider,
        trustedFinal: event.trustedFinal,
      });
      if (policy.mode !== "auto") return result(base);
      return beginSubmission(base, text);
    }

    case "RECOGNITION_ERROR": {
      if (!isCurrentRecognition(state, event)) return result(state);
      return result({
        ...state,
        phase: advisorInteractionPhase.ERROR,
        activeSessionId: null,
        retryToken: null,
        lastError: String(event.message || "语音识别暂时不可用，您可以直接输入"),
      });
    }

    case "KEYBOARD_FOCUS": {
      const effects = cancellationEffects(state);
      return result({
        ...state,
        phase: state.activeSubmissionId != null
          ? advisorInteractionPhase.SUBMITTING
          : state.turnPending
            ? advisorInteractionPhase.AWAITING_RESPONSE
            : advisorInteractionPhase.EDITING,
        keyboardFocused: true,
        activeSessionId: null,
        retryToken: null,
        countdownToken: null,
        confirmationReason: null,
      }, effects);
    }

    case "KEYBOARD_BLUR": {
      const cleared = { ...state, keyboardFocused: false };
      if (cleared.activeSubmissionId != null || cleared.turnPending) return result(cleared);
      if (cleared.draft.trim()) return result({ ...cleared, phase: advisorInteractionPhase.EDITING });
      if (cleared.explicitlyPaused) return result({ ...cleared, phase: advisorInteractionPhase.PAUSED });
      if (cleared.autoListenEnabled) return beginRecognition(cleared, "keyboard-blur");
      return result({ ...cleared, phase: advisorInteractionPhase.IDLE });
    }

    case "DRAFT_CHANGED": {
      const effects = cancellationEffects(state);
      const draft = String(event.value || "");
      const source = draft
        ? state.source === "voice" ? "mixed" : "keyboard"
        : null;
      return result({
        ...state,
        phase: state.explicitlyPaused
          ? advisorInteractionPhase.PAUSED
          : advisorInteractionPhase.EDITING,
        draft,
        draftRevision: state.draftRevision + 1,
        source,
        activeSessionId: null,
        retryToken: null,
        countdownToken: null,
        confirmationReason: null,
        lastError: "",
      }, effects);
    }

    case "MIC_PAUSE": {
      const effects = cancellationEffects(state);
      return result({
        ...state,
        phase: state.activeSubmissionId != null
          ? advisorInteractionPhase.SUBMITTING
          : state.turnPending
            ? advisorInteractionPhase.AWAITING_RESPONSE
            : advisorInteractionPhase.PAUSED,
        explicitlyPaused: true,
        activeSessionId: null,
        retryToken: null,
        countdownToken: null,
        confirmationReason: null,
      }, effects);
    }

    case "MIC_RESUME": {
      const cleared = {
        ...state,
        explicitlyPaused: false,
        autoListenEnabled: true,
        retryToken: null,
        countdownToken: null,
      };
      if (cleared.activeSubmissionId != null || cleared.turnPending || cleared.keyboardFocused) return result(cleared);
      return beginRecognition(cleared, "explicit-resume");
    }

    case "AUTO_SUBMIT_DUE": {
      const text = String(event.text || "").trim();
      const valid = state.phase === advisorInteractionPhase.COUNTDOWN
        && state.countdownToken != null
        && event.countdownToken === state.countdownToken
        && event.draftRevision === state.draftRevision
        && text === state.draft.trim()
        && !state.explicitlyPaused
        && !state.keyboardFocused;
      if (!valid) return result(state);
      return beginSubmission(state, text);
    }

    case "SUBMIT_REQUESTED": {
      const effects = cancellationEffects(state);
      return beginSubmission(state, event.text ?? state.draft, effects);
    }

    case "SUBMIT_SUCCEEDED": {
      if (state.activeSubmissionId == null || event.submissionId !== state.activeSubmissionId) return result(state);
      return result({
        ...state,
        phase: advisorInteractionPhase.AWAITING_RESPONSE,
        draft: "",
        draftRevision: state.draftRevision + 1,
        source: null,
        activeSubmissionId: null,
        turnPending: true,
        confirmationReason: null,
        lastError: "",
      });
    }

    case "SUBMIT_FAILED": {
      if (state.activeSubmissionId == null || event.submissionId !== state.activeSubmissionId) return result(state);
      return result({
        ...state,
        phase: advisorInteractionPhase.ERROR,
        activeSubmissionId: null,
        turnPending: false,
        lastError: String(event.message || "发送失败，请重试"),
      });
    }

    case "RESPONSE_COMPLETE": {
      if (!state.turnPending || state.phase !== advisorInteractionPhase.AWAITING_RESPONSE) return result(state);
      const cleared = { ...state, turnPending: false };
      if (cleared.explicitlyPaused) return result({ ...cleared, phase: advisorInteractionPhase.PAUSED });
      if (cleared.keyboardFocused || cleared.draft.trim()) return result({ ...cleared, phase: advisorInteractionPhase.EDITING });
      if (cleared.autoListenEnabled) return beginRecognition(cleared, "response-complete");
      return result({ ...cleared, phase: advisorInteractionPhase.IDLE });
    }

    default:
      return result(state);
  }
}

export function isAdvisorRecognitionCurrent(state, sessionId) {
  return state.activeSessionId != null && state.activeSessionId === sessionId;
}

export function advisorInteractionNeedsConfirmation(state) {
  return state.phase === advisorInteractionPhase.CONFIRM_SENSITIVE
    || state.phase === advisorInteractionPhase.CONFIRM_LOW;
}
