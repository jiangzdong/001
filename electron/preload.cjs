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
  launchVirtualSeniorTest: () => ipcRenderer.invoke("virtual-senior:launch-mode"),
  openVirtualSeniorControl: () => ipcRenderer.invoke("virtual-senior:open-control"),
  closeVirtualSeniorControl: () => ipcRenderer.invoke("virtual-senior:close-control"),
  virtualSeniorStatus: () => ipcRenderer.invoke("virtual-senior:status"),
  virtualSeniorResidentSearch: (payload) => ipcRenderer.invoke("virtual-senior:resident-search", payload),
  virtualSeniorResidentDetail: (payload) => ipcRenderer.invoke("virtual-senior:resident-detail", payload),
  virtualSeniorLiveCatalog: () => ipcRenderer.invoke("virtual-senior:live-catalog"),
  virtualSeniorLivePrepare: (payload) => ipcRenderer.invoke("virtual-senior:live-prepare", payload),
  virtualSeniorLivePrepareRetry: (payload) => ipcRenderer.invoke("virtual-senior:live-prepare-retry", payload),
  virtualSeniorLiveBegin: (runId) => ipcRenderer.invoke("virtual-senior:live-begin", runId),
  virtualSeniorLiveAck: (payload) => ipcRenderer.invoke("virtual-senior:live-ack", payload),
  virtualSeniorLiveCancel: (runId) => ipcRenderer.invoke("virtual-senior:live-cancel", runId),
  virtualSeniorLiveReports: () => ipcRenderer.invoke("virtual-senior:live-reports"),
  onVirtualSeniorLiveEvent: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("virtual-senior:live-event", listener);
    return () => ipcRenderer.removeListener("virtual-senior:live-event", listener);
  },
  virtualSeniorCatalog: () => ipcRenderer.invoke("virtual-senior:catalog"),
  virtualSeniorCommunityStatus: () => ipcRenderer.invoke("virtual-senior:community-status"),
  startVirtualSeniorCommunityJob: (payload) => ipcRenderer.invoke("virtual-senior:community-start", payload),
  virtualSeniorCommunityJob: (jobId) => ipcRenderer.invoke("virtual-senior:community-job", jobId),
  pauseVirtualSeniorCommunityJob: (jobId) => ipcRenderer.invoke("virtual-senior:community-pause", jobId),
  cancelVirtualSeniorCommunityJob: (jobId) => ipcRenderer.invoke("virtual-senior:community-cancel", jobId),
  resumeVirtualSeniorCommunityJob: (jobId) => ipcRenderer.invoke("virtual-senior:community-resume", jobId),
  rerunFailedVirtualSeniorCommunityJob: (jobId) => ipcRenderer.invoke("virtual-senior:community-rerun-failed", jobId),
  virtualSeniorCohortPreview: (payload) => ipcRenderer.invoke("virtual-senior:cohort-preview", payload),
  runVirtualSeniorCase: (payload) => ipcRenderer.invoke("virtual-senior:run-case", payload),
  runVirtualSeniorBatch: (payload) => ipcRenderer.invoke("virtual-senior:run-batch", payload),
  generateVirtualSeniorVariant: (payload) => ipcRenderer.invoke("virtual-senior:generate-variant", payload),
  cancelVirtualSeniorRun: (runId) => ipcRenderer.invoke("virtual-senior:cancel", runId),
  pauseVirtualSeniorBatch: (batchId) => ipcRenderer.invoke("virtual-senior:pause", batchId),
  resumeVirtualSeniorBatch: (batchId) => ipcRenderer.invoke("virtual-senior:resume", batchId),
  rerunFailedVirtualSeniorBatch: (batchId) => ipcRenderer.invoke("virtual-senior:rerun-failed", batchId),
  latestVirtualSeniorBatch: () => ipcRenderer.invoke("virtual-senior:latest"),
  runtimeStatus: () => ipcRenderer.invoke("runtime:status"),
  exit: () => ipcRenderer.invoke("app:exit"),
  qaAvatar: process.argv.includes("--qa-avatar"),
  virtualSeniorAvailable: process.argv.includes("--virtual-senior-test"),
  virtualSeniorAutoOpen: process.argv.includes("--open-virtual-senior"),
  virtualSeniorControlSurface: process.argv.includes("--virtual-senior-control"),
  virtualSeniorDualScreen: process.argv.includes("--virtual-senior-dual-screen"),
  platform: process.platform,
});
