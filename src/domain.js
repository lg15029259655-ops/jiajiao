const ACTIVE_STATUSES = Object.freeze(["active", "paused"]);
const HISTORY_STATUSES = Object.freeze(["completed", "cancelled", "deleted"]);
const ALL_STATUSES = Object.freeze([...ACTIVE_STATUSES, ...HISTORY_STATUSES]);

const TRANSITIONS = Object.freeze({
  active: Object.freeze(["paused", "cancelled", "deleted"]),
  paused: Object.freeze(["active", "completed", "cancelled", "deleted"]),
  completed: Object.freeze([]),
  cancelled: Object.freeze([]),
  deleted: Object.freeze([])
});

function domainError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function assertTransition(from, to) {
  if (!(TRANSITIONS[from] || []).includes(to)) {
    throw domainError("ORDER_STATUS_INVALID", "当前状态不能执行此操作", 409);
  }
}

function publicOrder(order) {
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    studentGender: order.studentGender || "",
    grade: order.grade || "",
    subject: order.subject || "",
    score: order.score || "",
    lessonTime: order.lessonTime || "",
    price: order.price || "",
    area: order.area || "",
    address: order.address || "",
    requirement: order.requirement || "",
    agentName: order.agentName || "中介",
    agentWechat: order.agentWechat || "",
    createdAt: order.createdAt || "",
    updatedAt: order.updatedAt || ""
  };
}

function shouldAnonymize(order, currentDate = new Date()) {
  if (!HISTORY_STATUSES.includes(order.status) || !order.closedAt) return false;
  const cutoff = new Date(currentDate);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  return new Date(order.closedAt) <= cutoff;
}

module.exports = {
  ACTIVE_STATUSES,
  ALL_STATUSES,
  HISTORY_STATUSES,
  TRANSITIONS,
  assertTransition,
  domainError,
  publicOrder,
  shouldAnonymize
};
