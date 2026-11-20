export const CASE_STEPS = ['已收件', '待补文件', '已递交政府部门', '实地检查', '已批准', '已完成'] as const;
export type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;
export const STEP_CANCELLED = '已取消';
