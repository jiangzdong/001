"use strict";

function boundedText(value, maxLength = 500) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function createSessionMemoryStore({ maxSessions = 64, maxTurns = 8, maxIdleMs = 30 * 60 * 1000, now = () => Date.now() } = {}) {
  const sessions = new Map();

  function prune() {
    const cutoff = now() - maxIdleMs;
    for (const [sessionId, session] of sessions) {
      if (session.updatedAt < cutoff) sessions.delete(sessionId);
    }
    while (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value);
  }

  function recordTurn(sessionId, turn = {}) {
    prune();
    const timestamp = now();
    const existing = sessions.get(sessionId) || { createdAt: timestamp, turns: [] };
    const sensitive = Boolean(turn.sensitive);
    existing.turns.push(Object.freeze({
      turnId: boundedText(turn.turnId, 120),
      intent: boundedText(turn.intent, 120) || "unknown",
      status: boundedText(turn.status, 40) || "unknown",
      sensitive,
      userText: sensitive ? null : boundedText(turn.userText),
      assistantText: sensitive ? null : boundedText(turn.assistantText),
      at: timestamp,
    }));
    existing.turns = existing.turns.slice(-maxTurns);
    existing.updatedAt = timestamp;
    sessions.delete(sessionId);
    sessions.set(sessionId, existing);
    prune();
  }

  function snapshot(sessionId) {
    prune();
    const session = sessions.get(sessionId);
    if (!session) return { sessionId, turns: [], expiresAt: null };
    return {
      sessionId,
      turns: session.turns.map((turn) => ({ ...turn })),
      expiresAt: session.updatedAt + maxIdleMs,
    };
  }

  function clear(sessionId) {
    return sessions.delete(sessionId);
  }

  function clearAll() {
    const cleared = sessions.size;
    sessions.clear();
    return cleared;
  }

  function status() {
    prune();
    return { mode: "session_only", persistent: false, maxSessions, maxTurns, maxIdleMs, sessions: sessions.size };
  }

  return { recordTurn, snapshot, clear, clearAll, status };
}

module.exports = { createSessionMemoryStore };
