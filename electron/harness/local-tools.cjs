"use strict";

const FIXTURES = Object.freeze({
  services: {
    meal_service: { serviceId: "meal_service", name: "助餐服务", schedule: "11:30-13:00", speechSchedule: "十一点半到十三点", location: "一楼助餐区", bookingRequired: false, factIds: ["fixture:meal_service:v1"] },
  },
  activities: {
    health_lecture: { activityId: "health_lecture", title: "健康讲堂", summary: "讲解秋季慢病管理和居家安全", startAt: "2026-09-02T14:30:00+08:00", location: "二楼多功能室", factIds: ["fixture:health_lecture:v1"] },
    baduanjin: { activityId: "baduanjin", title: "八段锦", summary: "适合长者的舒缓练习", startAt: "2026-09-02T09:30:00+08:00", location: "一楼活动区", factIds: ["fixture:baduanjin:v1"] },
  },
  member: { points: 2680, balance: 126.5, source: "demo-fixture-v1" },
});

const required = (...keys) => (input) => keys.filter((key) => input[key] == null || input[key] === "").map((key) => `缺少 ${key}`);

function registerLocalTools(registry) {
  registry.register({
    name: "station.get_service_schedule", description: "查询站点服务时间和地点", sensitivity: "public", validate: required("serviceId"),
    execute: ({ serviceId }) => {
      const value = FIXTURES.services[serviceId];
      if (!value) throw Object.assign(new Error("服务时间尚未配置"), { code: "SERVICE_SCHEDULE_NOT_CONFIGURED" });
      return value;
    },
  });
  registry.register({
    name: "station.get_activity", description: "查询活动详情", sensitivity: "public", validate: required("activityId"),
    execute: ({ activityId }) => {
      const value = FIXTURES.activities[activityId];
      if (!value) throw Object.assign(new Error("没有找到该活动"), { code: "ACTIVITY_NOT_FOUND" });
      return value;
    },
  });
  registry.register({
    name: "member.get_points", description: "查询已认证用户本人的积分", sensitivity: "personal", action: "member:read:self",
    validate: required("owner"), execute: () => ({ points: FIXTURES.member.points, source: FIXTURES.member.source }),
  });
  registry.register({
    name: "member.get_balance", description: "查询已认证用户本人的余额", sensitivity: "personal", action: "member:read:self",
    validate: required("owner"), execute: () => ({ balance: FIXTURES.member.balance, currency: "CNY", source: FIXTURES.member.source }),
  });
  return registry;
}

module.exports = { FIXTURES, registerLocalTools };
