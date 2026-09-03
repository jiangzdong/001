"use strict";

const { createToolRegistry } = require("./tool-registry.cjs");
const { createAgentRuntime } = require("./agent-runtime.cjs");
const { createSessionMemoryStore } = require("./memory-store.cjs");
const { createMcpGateway } = require("./mcp-gateway.cjs");
const { localExecutors, registerMcpTools } = require("./mcp-tools.cjs");
const { createDeepSeekAgent } = require("./model-agent.cjs");
const { createScenarioSkillResolver } = require("./scenario-skills.cjs");

function createXiaoanHarness(options = {}) {
  const gateway = options.gateway || createMcpGateway({
    servers: options.mcpServers,
    fetchImpl: options.fetchImpl,
    localExecutors: localExecutors(),
    clientVersion: options.clientVersion,
  });
  const registry = registerMcpTools(createToolRegistry(), gateway);
  const memoryStore = options.memoryStore || createSessionMemoryStore({ now: options.now });
  const scenarioResolver = options.scenarioResolver || createScenarioSkillResolver({ root: options.skillsRoot });
  const modelAgent = options.getDeepSeekKey ? createDeepSeekAgent({
    getKey: options.getDeepSeekKey,
    skillText: options.skillText,
    fetchImpl: options.fetchImpl,
  }) : null;
  return createAgentRuntime({
    registry,
    ...options,
    planner: options.planner || modelAgent?.planner,
    composer: options.composer || modelAgent?.composer,
    memoryStore,
    scenarioResolver,
    capabilities: {
      mcp: gateway.status,
      model: { provider: modelAgent ? "deepseek" : "deterministic-test", configured: Boolean(options.getDeepSeekKey?.()) },
      scenarios: scenarioResolver.describe(),
    },
  });
}

module.exports = { createXiaoanHarness, createToolRegistry, createAgentRuntime, createSessionMemoryStore, createMcpGateway };
