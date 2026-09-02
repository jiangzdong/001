"use strict";

function evaluatePolicy({ tool, actor = {}, input = {} } = {}) {
  if (!tool) return { decision: "DENY", reasonCode: "TOOL_NOT_FOUND" };
  if (tool.sensitivity === "public") return { decision: "ALLOW", reasonCode: "PUBLIC_STATION_INFO" };
  if (input.owner && input.owner !== "self") return { decision: "DENY", reasonCode: "CROSS_SUBJECT_DENIED" };
  if (!actor.subjectToken || !["demo_verified", "verified"].includes(actor.authLevel)) {
    return { decision: "AUTH_REQUIRED", reasonCode: "AUTH_MISSING", requiredAuthLevel: "demo_verified" };
  }
  if (tool.action && !(actor.scopes || []).includes(tool.action)) {
    return { decision: "DENY", reasonCode: "SCOPE_DENIED", requiredScopes: [tool.action] };
  }
  return { decision: "ALLOW", reasonCode: "VERIFIED_SELF" };
}

module.exports = { evaluatePolicy };
