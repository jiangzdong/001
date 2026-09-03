const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kioskBridge", {
  speechStatus: () => ipcRenderer.invoke("speech:status"),
  recognizePcm: (samples, sampleRate = 16000) => ipcRenderer.invoke("speech:recognize", { samples, sampleRate }),
  recognizePreviewPcm: (samples, sampleRate = 16000) => ipcRenderer.invoke("speech:recognize-preview", { samples, sampleRate }),
  synthesizeSpeech: (text, options = {}) => ipcRenderer.invoke("speech:synthesize", { text, ...options }),
  synthesizeSpeechStream: async (text, options = {}, onEvent) => {
    const turnId = String(options?.turnId || "");
    const streamId = String(options?.streamId || "");
    let receivedChunks = 0;
    let expectedChunks = null;
    let drainResolve = null;
    const resolveDrainIfComplete = () => {
      if (drainResolve && expectedChunks != null && receivedChunks >= expectedChunks) {
        const resolve = drainResolve;
        drainResolve = null;
        resolve();
      }
    };
    const listener = (_event, message) => {
      if (message?.turnId !== turnId || message?.streamId !== streamId) return;
      if (message?.type === "chunk") receivedChunks += 1;
      if (typeof onEvent === "function") onEvent(message);
      resolveDrainIfComplete();
    };
    ipcRenderer.on("speech:stream-event", listener);
    try {
      const result = await ipcRenderer.invoke("speech:synthesize-stream", { text, ...options });
      expectedChunks = Math.max(0, Number(result?.chunkCount) || 0);
      if (receivedChunks < expectedChunks) {
        await Promise.race([
          new Promise((resolve) => { drainResolve = resolve; resolveDrainIfComplete(); }),
          new Promise((resolve) => setTimeout(resolve, 800)),
        ]);
      }
      return result;
    } finally {
      ipcRenderer.removeListener("speech:stream-event", listener);
    }
  },
  alignSpeech: (text, samples, sampleRate = 16000, options = {}) => ipcRenderer.invoke("speech:align", { text, samples, sampleRate, ...options }),
  cancelSpeechTurn: (turnId) => ipcRenderer.invoke("speech:cancel", turnId),
  avatarStatus: () => ipcRenderer.invoke("avatar:status"),
  renderAvatar: (text, options = {}) => ipcRenderer.invoke("avatar:render", { text, ...options }),
  streamAvatar: (text, options = {}, onEvent) => {
    const turnId = String(options?.turnId || "");
    const listener = (_event, message) => {
      if (message?.turnId === turnId && typeof onEvent === "function") onEvent(message);
    };
    ipcRenderer.on("avatar:stream-event", listener);
    return ipcRenderer.invoke("avatar:render-stream", { text, ...options }).finally(() => ipcRenderer.removeListener("avatar:stream-event", listener));
  },
  cancelAvatarTurn: (turnId) => ipcRenderer.invoke("avatar:cancel", turnId),
  deepSeekStatus: () => ipcRenderer.invoke("deepseek:status"),
  saveDeepSeekKey: (key) => ipcRenderer.invoke("deepseek:save-key", key),
  clearDeepSeekKey: () => ipcRenderer.invoke("deepseek:clear-key"),
  mcpConfigStatus: () => ipcRenderer.invoke("mcp:config-status"),
  testMcpConfig: (servers) => ipcRenderer.invoke("mcp:test-config", { servers }),
  saveMcpConfig: (servers) => ipcRenderer.invoke("mcp:save-config", { servers }),
  clearMcpConfig: () => ipcRenderer.invoke("mcp:clear-config"),
  deepSeekChat: (payload) => ipcRenderer.invoke("deepseek:chat", Array.isArray(payload) ? { messages: payload } : payload),
  deepSeekChatStream: (payload, onChunk) => {
    const requestId = String(payload?.requestId || "");
    const listener = (_event, message) => {
      if (message?.requestId === requestId && typeof onChunk === "function") onChunk(message);
    };
    ipcRenderer.on("deepseek:chunk", listener);
    return ipcRenderer.invoke("deepseek:chat-stream", payload).finally(() => ipcRenderer.removeListener("deepseek:chunk", listener));
  },
  cancelDeepSeekChat: (requestId) => ipcRenderer.invoke("deepseek:cancel", requestId),
  interpretAssessment: (payload) => ipcRenderer.invoke("deepseek:interpret-assessment", payload),
  interpretSymptom: (payload) => ipcRenderer.invoke("deepseek:interpret-symptom", payload),
  agentTurn: (payload) => ipcRenderer.invoke("agent:turn", payload),
  cancelAgentTurn: (runId) => ipcRenderer.invoke("agent:cancel", runId),
  agentMemory: (sessionId) => ipcRenderer.invoke("agent:memory", sessionId),
  clearAgentSession: (sessionId) => ipcRenderer.invoke("agent:clear-session", sessionId),
  agentStatus: () => ipcRenderer.invoke("agent:status"),
  runtimeStatus: () => ipcRenderer.invoke("runtime:status"),
  exit: () => ipcRenderer.invoke("app:exit"),
  qaAvatar: process.argv.includes("--qa-avatar"),
  platform: process.platform,
});
