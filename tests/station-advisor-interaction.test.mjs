import assert from "node:assert/strict";
import test from "node:test";
import {
  advisorInteractionEffect,
  advisorInteractionNeedsConfirmation,
  advisorInteractionPhase,
  advisorInteractionRetryDelayMs,
  createAdvisorInteractionState,
  isAdvisorRecognitionCurrent,
  reduceAdvisorInteraction,
} from "../src/stationAdvisorInteraction.js";

function transition(state, event) {
  return reduceAdvisorInteraction(state, event);
}

function firstEffect(result, type) {
  return result.effects.find((effect) => effect.type === type);
}

function startDefaultListening() {
  let result = transition(createAdvisorInteractionState(), { type: "APP_READY" });
  const start = firstEffect(result, advisorInteractionEffect.START_RECOGNITION);
  assert.ok(start);
  result = transition(result.state, { type: "LISTENING_STARTED", sessionId: start.sessionId });
  return { state: result.state, sessionId: start.sessionId };
}

test("default policy starts listening as soon as the app is ready", () => {
  const initial = createAdvisorInteractionState();
  const result = transition(initial, { type: "APP_READY" });
  const start = firstEffect(result, advisorInteractionEffect.START_RECOGNITION);

  assert.equal(result.state.phase, advisorInteractionPhase.STARTING);
  assert.equal(result.state.explicitlyPaused, false);
  assert.deepEqual(start, {
    type: advisorInteractionEffect.START_RECOGNITION,
    sessionId: 1,
    reason: "initial-auto-listen",
  });
  assert.equal(isAdvisorRecognitionCurrent(result.state, 1), true);

  const repeatedReady = transition(result.state, { type: "APP_READY" });
  assert.deepEqual(repeatedReady, { state: result.state, effects: [] });
});

test("no speech schedules a recoverable retry with a fresh recognition session", () => {
  const listening = startDefaultListening();
  let result = transition(listening.state, {
    type: "NO_SPEECH",
    sessionId: listening.sessionId,
  });
  const retry = firstEffect(result, advisorInteractionEffect.SCHEDULE_RETRY);

  assert.equal(result.state.phase, advisorInteractionPhase.RETRY_WAIT);
  assert.equal(result.state.activeSessionId, null);
  assert.deepEqual(retry, {
    type: advisorInteractionEffect.SCHEDULE_RETRY,
    retryToken: 1,
    delayMs: advisorInteractionRetryDelayMs,
  });

  const paused = transition(result.state, { type: "MIC_PAUSE" });
  assert.deepEqual(firstEffect(paused, advisorInteractionEffect.CANCEL_RETRY), {
    type: advisorInteractionEffect.CANCEL_RETRY,
    retryToken: retry.retryToken,
  });
  const blockedRetry = transition(paused.state, { type: "RETRY_DUE", retryToken: retry.retryToken });
  assert.equal(blockedRetry.state.phase, advisorInteractionPhase.PAUSED);
  assert.equal(firstEffect(blockedRetry, advisorInteractionEffect.START_RECOGNITION), undefined);

  result = transition(result.state, { type: "RETRY_DUE", retryToken: retry.retryToken });
  const restart = firstEffect(result, advisorInteractionEffect.START_RECOGNITION);
  assert.equal(result.state.phase, advisorInteractionPhase.STARTING);
  assert.equal(restart.sessionId, 2);
  assert.equal(restart.reason, "recoverable-retry");
});

test("keyboard focus pauses recognition and preserves partial and edited text", () => {
  const listening = startDefaultListening();
  let result = transition(listening.state, {
    type: "RECOGNITION_PARTIAL",
    sessionId: listening.sessionId,
    text: "今天有活动吗",
  });
  result = transition(result.state, { type: "KEYBOARD_FOCUS" });

  assert.equal(result.state.phase, advisorInteractionPhase.EDITING);
  assert.equal(result.state.keyboardFocused, true);
  assert.equal(result.state.draft, "今天有活动吗");
  assert.deepEqual(firstEffect(result, advisorInteractionEffect.ABORT_RECOGNITION), {
    type: advisorInteractionEffect.ABORT_RECOGNITION,
    sessionId: listening.sessionId,
  });

  result = transition(result.state, { type: "DRAFT_CHANGED", value: "今天有八段锦吗" });
  assert.equal(result.state.draft, "今天有八段锦吗");
  assert.equal(result.state.source, "mixed");

  const stale = transition(result.state, {
    type: "RECOGNITION_FINAL",
    sessionId: listening.sessionId,
    text: "帮我查会员积分",
    confidence: 0.99,
  });
  assert.deepEqual(stale, { state: result.state, effects: [] });

  const blurred = transition(stale.state, { type: "KEYBOARD_BLUR" });
  assert.equal(blurred.state.phase, advisorInteractionPhase.EDITING);
  assert.equal(blurred.state.draft, "今天有八段锦吗");
  assert.equal(firstEffect(blurred, advisorInteractionEffect.START_RECOGNITION), undefined);
});

test("a final recognition result submits immediately and only once", () => {
  const listening = startDefaultListening();
  const result = transition(listening.state, {
    type: "RECOGNITION_FINAL",
    sessionId: listening.sessionId,
    text: "今天站点有什么活动",
    confidence: 0.96,
  });
  const submission = firstEffect(result, advisorInteractionEffect.SUBMIT);
  assert.equal(result.state.phase, advisorInteractionPhase.SUBMITTING);
  assert.equal(submission.text, "今天站点有什么活动");
  assert.equal(submission.intent, "activities");

  const duplicate = transition(result.state, {
    type: "RECOGNITION_FINAL",
    sessionId: listening.sessionId,
    text: "今天站点有什么活动",
  });
  assert.equal(firstEffect(duplicate, advisorInteractionEffect.SUBMIT), undefined);
  assert.equal(duplicate.state.submissionSequence, 1);
});

test("trusted final offline recognition without confidence submits immediately", () => {
  const listening = startDefaultListening();
  const result = transition(listening.state, {
    type: "RECOGNITION_FINAL",
    sessionId: listening.sessionId,
    text: "今天站点有什么活动",
    provider: "sherpa-onnx-sensevoice-local",
    trustedFinal: true,
  });

  assert.equal(result.state.phase, advisorInteractionPhase.SUBMITTING);
  assert.ok(firstEffect(result, advisorInteractionEffect.SUBMIT));
});

test("untrusted and low-confidence final recognition also submits directly", () => {
  const scenarios = [
    { provider: "web-speech", trustedFinal: false },
    { provider: "web-speech", trustedFinal: false, confidence: 0.96 },
    { provider: "sherpa-onnx", trustedFinal: true },
    { provider: "sherpa-onnx-sensevoice-local", trustedFinal: true, confidence: 0.48 },
  ];

  for (const scenario of scenarios) {
    const listening = startDefaultListening();
    const result = transition(listening.state, {
      type: "RECOGNITION_FINAL",
      sessionId: listening.sessionId,
      text: "站点有什么服务",
      ...scenario,
    });
    assert.equal(result.state.phase, advisorInteractionPhase.SUBMITTING);
    assert.ok(firstEffect(result, advisorInteractionEffect.SUBMIT));
    assert.equal(advisorInteractionNeedsConfirmation(result.state), false);
  }
});

test("every accepted recognition final emits only one immediate submit effect", () => {
  const scenarios = [
    { text: "今天站点有什么活动", confidence: 0.96 },
    { text: "帮我查一下会员积分", confidence: 0.99 },
    { text: "站点有什么服务", confidence: 0.01, provider: "web-speech", trustedFinal: false },
    { text: "我想问其他事情", provider: "sherpa-onnx-sensevoice-local", trustedFinal: true },
  ];

  for (const scenario of scenarios) {
    const listening = startDefaultListening();
    const result = transition(listening.state, {
      type: "RECOGNITION_FINAL",
      sessionId: listening.sessionId,
      ...scenario,
    });

    assert.equal(result.state.phase, advisorInteractionPhase.SUBMITTING);
    assert.equal(result.state.activeSessionId, null);
    assert.equal(result.state.countdownToken, null);
    assert.equal(result.state.confirmationReason, null);
    assert.deepEqual(result.effects.map((effect) => effect.type), [advisorInteractionEffect.SUBMIT]);
    assert.equal(result.effects[0].text, scenario.text);
  }
});

test("a successful send resumes automatic listening only after the response completes", () => {
  let result = transition(createAdvisorInteractionState(), { type: "KEYBOARD_FOCUS" });
  result = transition(result.state, { type: "DRAFT_CHANGED", value: "助餐服务几点开始" });
  result = transition(result.state, { type: "KEYBOARD_BLUR" });
  result = transition(result.state, { type: "SUBMIT_REQUESTED" });
  const submission = firstEffect(result, advisorInteractionEffect.SUBMIT);

  assert.equal(result.state.phase, advisorInteractionPhase.SUBMITTING);
  assert.equal(submission.intent, "services");

  const duplicate = transition(result.state, { type: "SUBMIT_REQUESTED" });
  assert.equal(firstEffect(duplicate, advisorInteractionEffect.SUBMIT), undefined);

  result = transition(result.state, {
    type: "SUBMIT_SUCCEEDED",
    submissionId: submission.submissionId,
  });
  assert.equal(result.state.phase, advisorInteractionPhase.AWAITING_RESPONSE);
  assert.equal(result.state.draft, "");
  assert.equal(firstEffect(result, advisorInteractionEffect.START_RECOGNITION), undefined);

  result = transition(result.state, { type: "RESPONSE_COMPLETE" });
  const restart = firstEffect(result, advisorInteractionEffect.START_RECOGNITION);
  assert.equal(result.state.phase, advisorInteractionPhase.STARTING);
  assert.equal(restart.reason, "response-complete");
});

test("an explicit microphone pause blocks retries and response-driven restarts until resume", () => {
  const listening = startDefaultListening();
  let result = transition(listening.state, { type: "MIC_PAUSE" });

  assert.equal(result.state.explicitlyPaused, true);
  assert.equal(result.state.phase, advisorInteractionPhase.PAUSED);
  assert.ok(firstEffect(result, advisorInteractionEffect.ABORT_RECOGNITION));

  const lateNoSpeech = transition(result.state, {
    type: "NO_SPEECH",
    sessionId: listening.sessionId,
  });
  assert.deepEqual(lateNoSpeech, { state: result.state, effects: [] });

  const responseComplete = transition(result.state, { type: "RESPONSE_COMPLETE" });
  assert.equal(responseComplete.state.phase, advisorInteractionPhase.PAUSED);
  assert.equal(firstEffect(responseComplete, advisorInteractionEffect.START_RECOGNITION), undefined);

  result = transition(responseComplete.state, { type: "MIC_RESUME" });
  const restart = firstEffect(result, advisorInteractionEffect.START_RECOGNITION);
  assert.equal(result.state.explicitlyPaused, false);
  assert.equal(result.state.phase, advisorInteractionPhase.STARTING);
  assert.equal(restart.sessionId, 2);
  assert.equal(restart.reason, "explicit-resume");
});

test("sensitive and low-confidence final recognition never adds a confirmation step", async (t) => {
  const cases = [
    {
      name: "sensitive member query",
      text: "帮我查一下会员积分",
      confidence: 0.99,
      intent: "points",
    },
    {
      name: "low-confidence routine query",
      text: "站点有什么服务",
      confidence: 0.48,
      intent: "services",
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const listening = startDefaultListening();
      const result = transition(listening.state, {
        type: "RECOGNITION_FINAL",
        sessionId: listening.sessionId,
        text: scenario.text,
        confidence: scenario.confidence,
      });

      assert.equal(result.state.phase, advisorInteractionPhase.SUBMITTING);
      assert.equal(result.state.confirmationReason, null);
      assert.equal(advisorInteractionNeedsConfirmation(result.state), false);
      assert.equal(firstEffect(result, advisorInteractionEffect.SCHEDULE_AUTO_SUBMIT), undefined);
      const submission = firstEffect(result, advisorInteractionEffect.SUBMIT);
      assert.equal(submission.text, scenario.text);
      assert.equal(submission.intent, scenario.intent);
    });
  }
});

test("late results from an invalidated session never overwrite the current turn", () => {
  const first = startDefaultListening();
  let result = transition(first.state, {
    type: "RECOGNITION_PARTIAL",
    sessionId: first.sessionId,
    text: "旧的预览文字",
  });
  result = transition(result.state, { type: "MIC_PAUSE" });
  result = transition(result.state, { type: "MIC_RESUME" });
  const secondStart = firstEffect(result, advisorInteractionEffect.START_RECOGNITION);

  const staleFinal = transition(result.state, {
    type: "RECOGNITION_FINAL",
    sessionId: first.sessionId,
    text: "帮我查会员积分",
    confidence: 0.99,
  });
  assert.deepEqual(staleFinal, { state: result.state, effects: [] });

  result = transition(staleFinal.state, {
    type: "RECOGNITION_FINAL",
    sessionId: secondStart.sessionId,
    text: "今天有什么活动",
    confidence: 0.95,
  });
  assert.equal(result.state.phase, advisorInteractionPhase.SUBMITTING);
  assert.equal(result.state.draft, "今天有什么活动");

  const latePreview = transition(result.state, {
    type: "RECOGNITION_PARTIAL",
    sessionId: secondStart.sessionId,
    text: "旧的预览文字",
  });
  assert.deepEqual(latePreview, { state: result.state, effects: [] });
});
