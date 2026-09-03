"use strict";

const FIXTURES = Object.freeze({
  services: {},
  activities: {},
  member: {},
});

const required = (...keys) => (input) => keys.filter((key) => input[key] == null || input[key] === "").map((key) => `缺少 ${key}`);

function registerLocalTools(registry) {
  registry.register({
    name: "station.get_service_schedule", description: "查询站点服务时间和地点", sensitivity: "public", validate: required("serviceId"),
    execute: ({ serviceId }) => {
      const value = FIXTURES.services[serviceId];
      if (!value) throw Object.assign(new Error("站点服务详情尚未接入业务数据源"), { code: "DATA_NOT_CONFIGURED" });
      return value;
    },
  });
  registry.register({
    name: "station.get_activity", description: "查询活动详情", sensitivity: "public", validate: required("activityId"),
    execute: ({ activityId }) => {
      const value = FIXTURES.activities[activityId];
      if (!value) throw Object.assign(new Error("站点活动尚未接入业务数据源"), { code: "DATA_NOT_CONFIGURED" });
      return value;
    },
  });
  registry.register({
    name: "member.get_points", description: "查询已认证用户本人的积分", sensitivity: "personal", action: "member:read:self",
    validate: required("owner"), execute: () => { throw Object.assign(new Error("会员积分尚未接入业务数据源"), { code: "DATA_NOT_CONFIGURED" }); },
  });
  registry.register({
    name: "member.get_balance", description: "查询已认证用户本人的余额", sensitivity: "personal", action: "member:read:self",
    validate: required("owner"), execute: () => { throw Object.assign(new Error("会员余额尚未接入业务数据源"), { code: "DATA_NOT_CONFIGURED" }); },
  });
  return registry;
}

module.exports = { FIXTURES, registerLocalTools };
