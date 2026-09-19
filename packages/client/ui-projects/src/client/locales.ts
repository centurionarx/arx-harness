/** Copy owned by the project workspace. */
export const en = {
  title: 'Projects', close: 'Close', refresh: 'Refresh', loading: 'Loading…',
  empty: 'Create a project to organize plans, prompts and execution evidence.',
  name: 'Project name', workspace: 'Workspace', create: 'Create project',
  select: 'Choose a project', plan: 'Plan', summary: 'Plan summary',
  items: 'Task title', criteria: 'Acceptance criteria (one per line)',
  addTask: 'Add task', removeTask: 'Remove task', dependencies: 'Depends on',
  savePlan: 'Save new plan revision', approve: 'Approve this revision',
  saveBeforeApproval: 'Save your changes as a new revision before approving this plan.',
  approved: 'Approved revision', revision: 'Revision', prompts: 'Prompt library',
  promptName: 'Prompt name', template: 'Prompt content', savePrompt: 'Save prompt revision',
  newPrompt: 'New prompt', tasks: 'Execution evidence', noTasks: 'No task executions recorded.',
  openSession: 'Open execution', workflows: 'Workflow runs', noRuns: 'No workflow runs recorded.',
  history: 'Plan history', pending: 'Awaiting approval', stale: 'Reload the project before retrying a conflicting change.',
} satisfies Record<string, string>
/** Project dictionary key vocabulary. */
export type ProjectLocaleKey = keyof typeof en
