"use strict";

const { createToolRegistry } = require("./tool-registry.cjs");
const { registerLocalTools } = require("./local-tools.cjs");
const { createAgentRuntime } = require("./agent-runtime.cjs");
const { createSessionMemoryStore } = require("./memory-store.cjs");

function createXiaoanHarness(options = {}) {
  const registry = registerLocalTools(createToolRegistry());
  const memoryStore = options.memoryStore || createSessionMemoryStore({ now: options.now });
  return createAgentRuntime({ registry, ...options, memoryStore });
}

module.exports = { createXiaoanHarness, createToolRegistry, createAgentRuntime, createSessionMemoryStore };
