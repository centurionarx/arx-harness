/** Browser project workspace registration. */
import type { ClientContext } from '@arx-ai/arx-client-runtime/client'
import type {} from '@arx-ai/arx-api-remotes/client'
import type {} from '@arx-ai/arx-client-locale/client'
import type {} from '@arx-ai/arx-client-ui-sidebar/client'
import { ProjectsEntry, type ProjectsInjected } from './ProjectsEntry.tsx'
import { en, pt, type ProjectLocaleKey } from './locales.ts'

declare module '@arx-ai/arx-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Project workspace copy. */
    projects: ProjectLocaleKey
  }
}

/** Services needed by the project workspace contribution. */
export const inject = ['slots', 'locale', 'remote', 'remote.projects', 'sessions']

/** Mount the project action when the sidebar declares its action seat. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('projects', { en, pt }), 'ui-projects: dictionaries')
  const unwrap = async <T>(pending: Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>): Promise<T> => {
    const result = await pending
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const injected = (): ProjectsInjected => ({
    list: () => unwrap(ctx.remote.projects.list()),
    get: id => unwrap(ctx.remote.projects.get(id)),
    create: request => unwrap(ctx.remote.projects.create(request)),
    savePlan: (id, version, request) => unwrap(ctx.remote.projects.savePlan(id, version, request)),
    approvePlan: (id, version, revision) => unwrap(ctx.remote.projects.approvePlan(id, version, revision)),
    savePrompt: (id, version, request) => unwrap(ctx.remote.projects.savePrompt(id, version, request)),
    finalizeEvaluation: (id, version, request) => unwrap(ctx.remote.projects.finalizePromptEvaluation(id, version, request)),
    configureBudget: (id, version, request) => unwrap(ctx.remote.projects.configureBudget(id, version, request)),
    resumeRun: (id, version, request) => unwrap(ctx.remote.projects.resumeWorkflowRun(id, version, request)),
    reconcileRun: (id, version, request) => unwrap(ctx.remote.projects.reconcileWorkflowRun(id, version, request)),
    openSession: (id) => { ctx.sessions.open(id) },
  })
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'projects', order: 10, locale: 'projects', inject: injected,
  }, ProjectsEntry))
}
