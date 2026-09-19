import { useState, type ReactElement } from 'react'
import type { ProjectRecord, ProjectWorkflowRun } from '@arx-ai/arx-api-remotes/client'
import type { ProjectsInjected } from './ProjectsEntry.tsx'
type Controls = Pick<ProjectsInjected, 'configureBudget' | 'resumeRun' | 'reconcileRun'> & {
  project: ProjectRecord
  busy: boolean
  mutate: (operation: () => Promise<ProjectRecord>) => Promise<void>
}
/** Trusted operator controls keep changes separate from model requests. */
export function ProjectControls(props: Controls): ReactElement {
  const { project, busy, mutate, configureBudget } = props
  const [budget, setBudget] = useState(project.budget)
  return (
    <section>
      <h4>Execution limits</h4>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void mutate(() => configureBudget(project.id, project.version, budget))
        }}
      >
        <label>
          Concurrent runs
          <input
            type="number"
            min="1"
            required
            value={budget.maxActiveRuns}
            disabled={busy}
            onChange={(event) => {
              setBudget({ ...budget, maxActiveRuns: event.currentTarget.valueAsNumber })
            }}
          />
        </label>
        <label>
          Steps per run
          <input
            type="number"
            min="1"
            required
            value={budget.maxStepsPerRun}
            disabled={busy}
            onChange={(event) => {
              setBudget({ ...budget, maxStepsPerRun: event.currentTarget.valueAsNumber })
            }}
          />
        </label>
        <label>
          Duration per run (seconds)
          <input
            type="number"
            min="1"
            required
            value={budget.maxRunDurationMs / 1000}
            disabled={busy}
            onChange={(event) => {
              setBudget({ ...budget, maxRunDurationMs: event.currentTarget.valueAsNumber * 1000 })
            }}
          />
        </label>
        <p>
          Changes apply to new runs. Host safety limits also apply. Measured token usage appears in each step result;
          missing usage remains unknown.
        </p>
        <button disabled={busy}>Save execution limits</button>
      </form>
      {project.runs
        .filter(run => run.state === 'uncertain' || run.state === 'failed')
        .map(run => (
          <RunControl key={run.id} {...props} run={run} />
        ))}
    </section>
  )
}
function RunControl({
  project,
  run,
  busy,
  mutate,
  resumeRun,
  reconcileRun,
}: Controls & { run: ProjectWorkflowRun }): ReactElement {
  const [acknowledged, setAcknowledged] = useState(false)
  const [maxSteps, setMaxSteps] = useState(Math.max(run.maxSteps, project.budget.maxStepsPerRun))
  const [seconds, setSeconds] = useState(project.budget.maxRunDurationMs / 1000)
  const canResume =
    Number.isSafeInteger(maxSteps) &&
    maxSteps > run.launchedSteps &&
    maxSteps <= project.budget.maxStepsPerRun &&
    Number.isSafeInteger(seconds * 1000) &&
    seconds > 0 &&
    seconds * 1000 <= project.budget.maxRunDurationMs
  const budgetStopped =
    run.error === 'workflow run deadline elapsed' || run.error === 'workflow run step budget exhausted'
  return (
    <fieldset disabled={busy}>
      <legend>
        {project.workflows.find(item => item.id === run.workflowId)?.name} · {run.state}
      </legend>
      <p>{run.error}</p>
      {run.state === 'uncertain' ? (
        <>
          <p>Inspect child sessions and any external effects before releasing pending work for another attempt.</p>
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => {
                setAcknowledged(event.currentTarget.checked)
              }}
            />
            I checked the previous attempt and authorize retrying uncertain steps.
          </label>
          <button
            type="button"
            disabled={!acknowledged}
            onClick={() => {
              void mutate(() => reconcileRun(project.id, project.version, { runId: run.id, state: 'pending' }))
            }}
          >
            Release pending steps
          </button>
          <button
            type="button"
            onClick={() => {
              void mutate(() =>
                reconcileRun(project.id, project.version, {
                  runId: run.id,
                  state: 'failed',
                  error: 'Stopped after operator review',
                }),
              )
            }}
          >
            Stop this run
          </button>
        </>
      ) : budgetStopped ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void mutate(() =>
              resumeRun(project.id, project.version, { runId: run.id, maxSteps, maxDurationMs: seconds * 1000 }),
            )
          }}
        >
          <label>
            New total step allowance
            <input
              type="number"
              min={run.launchedSteps + 1}
              required
              value={maxSteps}
              onChange={(event) => {
                setMaxSteps(event.currentTarget.valueAsNumber)
              }}
            />
          </label>
          <label>
            Additional duration (seconds)
            <input
              type="number"
              min="1"
              required
              value={seconds}
              onChange={(event) => {
                setSeconds(event.currentTarget.valueAsNumber)
              }}
            />
          </label>
          {!canResume && (
            <p>
              Choose limits within the project budget. Increase the project limits first if the step ceiling has been
              reached.
            </p>
          )}
          <button disabled={!canResume}>Resume pending steps</button>
        </form>
      ) : null}
    </fieldset>
  )
}
