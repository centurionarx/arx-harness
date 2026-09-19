import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Modal } from '@arx-ai/arx-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@arx-ai/arx-client-ui-slots'
import type {
  CreateProjectRequest,
  ProjectId,
  ProjectRecord,
  ProjectSummary,
  SavePlanRequest,
  SavePromptRequest,
  SessionId,
  FinalizePromptEvaluationRequest,
  ProjectBudget,
  ResumeWorkflowRunRequest,
  ReconcileWorkflowRunRequest,
} from '@arx-ai/arx-api-remotes/client'
import type {} from '@arx-ai/arx-client-ui-sidebar/client'
import css from './ProjectsEntry.module.css'
import { PromptEvaluations } from './PromptEvaluations.tsx'
import { ProjectControls } from './ProjectControls.tsx'
import { PromptVariables } from './PromptVariables.tsx'
import { PlanEditor } from './PlanEditor.tsx'

/** Narrow project operations supplied by the plugin registration. */
export interface ProjectsInjected {
  list: () => Promise<readonly ProjectSummary[]>
  get: (id: ProjectId) => Promise<ProjectRecord | undefined>
  create: (request: CreateProjectRequest) => Promise<ProjectRecord>
  savePlan: (id: ProjectId, version: number, request: SavePlanRequest) => Promise<ProjectRecord>
  approvePlan: (id: ProjectId, version: number, revision: number) => Promise<ProjectRecord>
  savePrompt: (id: ProjectId, version: number, request: SavePromptRequest) => Promise<ProjectRecord>
  finalizeEvaluation: (
    id: ProjectId,
    version: number,
    request: FinalizePromptEvaluationRequest,
  ) => Promise<ProjectRecord>
  configureBudget: (id: ProjectId, version: number, request: ProjectBudget) => Promise<ProjectRecord>
  resumeRun: (id: ProjectId, version: number, request: ResumeWorkflowRunRequest) => Promise<ProjectRecord>
  reconcileRun: (id: ProjectId, version: number, request: ReconcileWorkflowRunRequest) => Promise<ProjectRecord>
  openSession: (id: SessionId) => void
}
type ProjectsProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'projects'> & InjectFace<ProjectsInjected>
type BoardProps = Pick<ProjectsProps, keyof ProjectsInjected | 't' | 'useWorkspaces'>

/** Sidebar entry; unmounting the dialog also invalidates outstanding board reads. */
export function ProjectsEntry(props: ProjectsProps): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={css.trigger}
        aria-label={props.t('title')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true)
        }}
      >
        <span aria-hidden="true">▤</span>
        {props.wide && props.t('title')}
      </button>
      <Modal
        className={css.dialog}
        contentClassName={css.content}
        open={open}
        onClose={() => {
          setOpen(false)
        }}
        title={props.t('title')}
        closeLabel={props.t('close')}
      >
        {open ? (
          <ProjectsBoard
            {...props}
            openSession={(id) => {
              props.openSession(id)
              setOpen(false)
            }}
          />
        ) : null}
      </Modal>
    </>
  )
}

/** Project editor keeps request snapshots local and always writes with a record version. */
export function ProjectsBoard({
  list,
  get,
  create,
  savePlan,
  approvePlan,
  savePrompt,
  finalizeEvaluation,
  configureBudget,
  resumeRun,
  reconcileRun,
  openSession,
  useWorkspaces,
  t,
}: BoardProps): ReactElement {
  const workspaces = useWorkspaces(state => state.items)
  const [catalog, setCatalog] = useState<readonly ProjectSummary[]>([])
  const [project, setProject] = useState<ProjectRecord>()
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [refresh, setRefresh] = useState(0)
  const generation = useRef(0)

  useEffect(() => {
    const request = ++generation.current
    setBusy(true)
    setError('')
    void Promise.all([list(), selected ? get(selected as ProjectId) : Promise.resolve(undefined)])
      .then(
        ([items, record]) => {
          if (request !== generation.current) return
          setCatalog(items)
          setProject(record)
        },
        (failure: unknown) => {
          if (request === generation.current) setError(String(failure))
        },
      )
      .finally(() => {
        if (request === generation.current) setBusy(false)
      })
    return () => {
      ++generation.current
    }
  }, [list, get, selected, refresh])

  const mutate = async (operation: () => Promise<ProjectRecord>): Promise<void> => {
    if (busy) return
    const request = ++generation.current
    setBusy(true)
    setError('')
    try {
      const record = await operation()
      if (request !== generation.current) return
      setProject(record)
      setCatalog((items) => {
        const summary: ProjectSummary = {
          id: record.id,
          version: record.version,
          workspaceId: record.workspaceId,
          name: record.name,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          ...(record.approvedPlan ? { approvedPlanRevision: record.approvedPlan.revision } : {}),
        }
        return items.some(item => item.id === record.id)
          ? items.map(item => (item.id === record.id ? summary : item))
          : [...items, summary]
      })
      setSelected(record.id)
    } catch (failure) {
      if (request === generation.current) setError(String(failure))
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  return (
    <div className={css.board} aria-busy={busy}>
      {error && (
        <div role="alert">
          {error}
          <p>{t('stale')}</p>
        </div>
      )}
      <div className={css.row}>
        <label>
          {t('select')}
          <select
            aria-label={t('select')}
            value={selected}
            disabled={busy}
            onChange={(event) => {
              setProject(undefined)
              setSelected(event.currentTarget.value)
            }}
          >
            <option value="">{t('select')}</option>
            {catalog.map(item => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setRefresh(value => value + 1)
          }}
        >
          {t('refresh')}
        </button>
      </div>
      <form
        className={css.row}
        onSubmit={(event) => {
          event.preventDefault()
          const workspace = workspaces.find(item => item.workspaceId === workspaceId)
          if (!workspace || !name.trim()) return
          void mutate(() => create({ name: name.trim(), workspaceId: workspace.workspaceId }))
        }}
      >
        <label>
          {t('name')}
          <input
            value={name}
            onChange={(event) => {
              setName(event.currentTarget.value)
            }}
            required
          />
        </label>
        <label>
          {t('workspace')}
          <select
            aria-label={t('workspace')}
            value={workspaceId}
            onChange={(event) => {
              setWorkspaceId(event.currentTarget.value)
            }}
            required
          >
            <option value="">{t('workspace')}</option>
            {workspaces.map(item => (
              <option key={item.workspaceId} value={item.workspaceId}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy || !workspaceId || !name.trim()}>{t('create')}</button>
      </form>
      {busy && <p role="status">{t('loading')}</p>}
      {!project && !busy && <p>{t('empty')}</p>}
      {project && (
        <ProjectDetail
          key={[project.id, project.version, refresh].join(':')}
          project={project}
          busy={busy}
          t={t}
          mutate={mutate}
          savePlan={savePlan}
          approvePlan={approvePlan}
          savePrompt={savePrompt}
          finalizeEvaluation={finalizeEvaluation}
          configureBudget={configureBudget}
          resumeRun={resumeRun}
          reconcileRun={reconcileRun}
          openSession={openSession}
        />
      )}
    </div>
  )
}

type DetailProps = Pick<
  BoardProps,
  | 't'
  | 'savePlan'
  | 'approvePlan'
  | 'savePrompt'
  | 'finalizeEvaluation'
  | 'configureBudget'
  | 'resumeRun'
  | 'reconcileRun'
  | 'openSession'
> & {
  project: ProjectRecord
  busy: boolean
  mutate: (operation: () => Promise<ProjectRecord>) => Promise<void>
}

/** Immutable history remains visible beside creation of the next revision. */
function ProjectDetail({
  project,
  busy,
  t,
  mutate,
  savePlan,
  approvePlan,
  savePrompt,
  finalizeEvaluation,
  configureBudget,
  resumeRun,
  reconcileRun,
  openSession,
}: DetailProps): ReactElement {
  const openExecution = (id: SessionId): (() => void) => () =>{  openSession(id) }
  const latest = project.plans.at(-1)
  const [planDirty, setPlanDirty] = useState(false)
  const [promptId, setPromptId] = useState('')
  const prompt = project.prompts.find(item => item.id === promptId)
  const [promptName, setPromptName] = useState('')
  const [template, setTemplate] = useState('')
  const [purpose, setPurpose] = useState('')
  const [tags, setTags] = useState('')
  const [variables, setVariables] = useState<SavePromptRequest['variablesSchema']>({})
  return (
    <div className={css.detail}>
      <h3>{project.name}</h3>
      <section>
        <h4>{t('plan')}</h4>
        <p>
          {t('approved')}: {project.approvedPlan?.revision ?? t('pending')}
        </p>
        <PlanEditor
          latest={latest}
          onDirtyChange={setPlanDirty}
          busy={busy}
          t={t}
          save={request => mutate(() => savePlan(project.id, project.version, request))}
        />
        {latest && planDirty && <p>{t('saveBeforeApproval')}</p>}
        {latest && (
          <button
            type="button"
            disabled={busy || planDirty || project.approvedPlan?.revision === latest.revision}
            onClick={() => {
              void mutate(() => approvePlan(project.id, project.version, latest.revision))
            }}
          >
            {t('approve')} {latest.revision}
          </button>
        )}
        <details>
          <summary>
            {t('history')} ({project.plans.length})
          </summary>
          {project.plans.map(plan => (
            <article key={plan.revision}>
              <strong>
                {t('revision')} {plan.revision}: {plan.summary}
              </strong>
              <ol>
                {plan.items.map(item => (
                  <li key={item.id}>
                    {item.title}
                    <ul>
                      {item.acceptanceCriteria.map((criterion, index) => (
                        <li key={index}>{criterion}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </details>
      </section>
      <section>
        <h4>{t('prompts')}</h4>
        <select
          aria-label={t('prompts')}
          value={promptId}
          onChange={(event) => {
            const next = project.prompts.find(item => item.id === event.currentTarget.value)
            setPurpose(next?.revisions.at(-1)?.purpose ?? '')
            setTags(next?.revisions.at(-1)?.tags.join(', ') ?? '')
            setVariables(next?.revisions.at(-1)?.variablesSchema ?? {})
            setPromptId(event.currentTarget.value)
            setPromptName(next?.name ?? '')
            setTemplate(next?.revisions.at(-1)?.template ?? '')
          }}
        >
          <option value="">{t('newPrompt')}</option>
          {project.prompts.map(item => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const revision = prompt?.revisions.at(-1)
            void mutate(() =>
              savePrompt(project.id, project.version, {
                ...(prompt ? { promptId: prompt.id } : {}),
                name: promptName,
                template,
                purpose: purpose.trim() || promptName,
                tags: tags
                  .split(',')
                  .map(tag => tag.trim())
                  .filter(Boolean),
                variablesSchema: variables,
                sourceSkills: revision?.sourceSkills ?? [],
              }),
            )
          }}
        >
          <label>
            {t('promptName')}
            <input
              required
              readOnly={prompt !== undefined}
              value={promptName}
              onChange={(event) => {
                setPromptName(event.currentTarget.value)
              }}
            />
          </label>
          <label>
            Purpose
            <input
              value={purpose}
              onChange={(event) => {
                setPurpose(event.currentTarget.value)
              }}
            />
          </label>
          <label>
            Tags (comma separated)
            <input
              value={tags}
              onChange={(event) => {
                setTags(event.currentTarget.value)
              }}
            />
          </label>
          <label>
            {t('template')}
            <textarea
              required
              value={template}
              onChange={(event) => {
                setTemplate(event.currentTarget.value)
              }}
            />
          </label>
          <PromptVariables key={promptId} initial={variables} change={setVariables} disabled={busy} />
          <button disabled={busy || !promptName.trim() || !template.trim()}>{t('savePrompt')}</button>
        </form>
        {prompt?.revisions.map(revision => (
          <details key={revision.revision}>
            <summary>
              {t('revision')} {revision.revision}
            </summary>
            <p>
              {revision.purpose} · {revision.tags.join(', ')}
            </p>
            <pre>{revision.template}</pre>
            <details>
              <summary>Examples and evaluation cases</summary>
              <pre>{JSON.stringify({ examples: revision.examples, cases: revision.evaluationCases }, null, 2)}</pre>
            </details>
            {revision.sourceSkills.map(skill => (
              <p key={skill.path}>
                {skill.repository} / {skill.path} · {skill.commit}
              </p>
            ))}
          </details>
        ))}
      </section>
      <section>
        <h4>{t('tasks')}</h4>
        {project.tasks.length === 0 && <p>{t('noTasks')}</p>}
        {project.tasks.map(task => (
          <article key={[task.planRevision, task.itemId].join(':')}>
            <strong>
              {project.plans
                .find(plan => plan.revision === task.planRevision)
                ?.items.find(item => item.id === task.itemId)?.title ?? task.itemId}
            </strong>
            <p>
              {t('revision')} {task.planRevision} · {task.state}
            </p>
            {task.execution && (
              <button
                type="button"
                onClick={openExecution(task.execution.sessionId)}
              >
                {t('openSession')}
              </button>
            )}
            <ul>
              {task.evidence.map((entry, index) => (
                <li key={index}>{entry}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      <PromptEvaluations
        project={project}
        busy={busy}
        finalize={evaluationId => mutate(() => finalizeEvaluation(project.id, project.version, { evaluationId }))}
        openSession={openSession}
      />
      <ProjectControls
        project={project}
        busy={busy}
        mutate={mutate}
        configureBudget={configureBudget}
        resumeRun={resumeRun}
        reconcileRun={reconcileRun}
      />
      <section>
        <h4>{t('workflows')}</h4>
        {project.runs.length === 0 && <p>{t('noRuns')}</p>}
        {project.runs.map(run => (
          <details key={run.id}>
            <summary>
              {project.workflows.find(item => item.id === run.workflowId)?.name} · {run.state}
            </summary>
            <p>
              {run.launchedSteps} / {run.maxSteps} · {run.deadlineAt}
            </p>
            <p>{run.error}</p>
            <ol>
              {run.steps.map(step => (
                <li key={step.stepId}>
                  {step.stepId}: {step.state} ({step.attempt})
                  {step.sessionId && (
                    <button
                      type="button"
                      onClick={openExecution(step.sessionId)}
                    >
                      {t('openSession')}
                    </button>
                  )}
                  {step.result !== undefined && (
                    <details>
                      <summary>Recorded result and usage</summary>
                      <pre>{JSON.stringify(step.result, null, 2)}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          </details>
        ))}
      </section>
    </div>
  )
}
