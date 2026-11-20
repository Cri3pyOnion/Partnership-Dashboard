/** Case stages in order. Every new case starts at 洽谈中 (discussion with the partner's client). */
export const CASE_STEPS = ['洽谈中', '收集文件', '已递交政府部门', '实地检查', '已批准', '已完成'] as const;
export type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;
/** A case can be dropped at any stage (stored as cancelled). */
export const STEP_CANCELLED = '已放弃';
