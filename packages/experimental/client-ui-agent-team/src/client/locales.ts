/** Agent Team roster and task graph copy. */
export const NS = 'agentTeam'

/** Simplified Chinese strings retained from the upstream Team overlay. */
export const zh = {
  'trigger': '团队：{members} 名成员，{tasks} 个任务',
  'members': '团队成员',
  'tasks': '任务依赖',
  'lead': '负责人',
  'status.running': '运行中',
  'status.idle': '空闲',
  'status.inactive': '未运行',
  'status.provisioning': '创建中',
  'status.failed': '失败',
  'task.pending': '待处理',
  'task.in_progress': '进行中',
  'task.completed': '已完成',
  'blockedBy': '依赖：{tasks}',
  'ready': '可开始',
  'open': '打开 {name} 的会话',
} as const

/** English strings registered by the current client composition. */
export const en: Record<TeamKey, string> = {
  'trigger': 'Team: {members} members, {tasks} tasks',
  'members': 'Team members',
  'tasks': 'Task dependencies',
  'lead': 'Lead',
  'status.running': 'running',
  'status.idle': 'idle',
  'status.inactive': 'inactive',
  'status.provisioning': 'provisioning',
  'status.failed': 'failed',
  'task.pending': 'pending',
  'task.in_progress': 'in progress',
  'task.completed': 'completed',
  'blockedBy': 'Blocked by: {tasks}',
  'ready': 'Ready',
  'open': 'Open {name} session',
}

/** Translation keys shared by the Team overlay dictionaries. */
export type TeamKey = keyof typeof zh
