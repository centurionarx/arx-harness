import type { ReactElement } from 'react'
import type { ProjectRecord, SessionId } from '@arx-ai/arx-api-remotes/client'
type EvaluationId = ProjectRecord['evaluations'][number]['id']
/** Comparable, case-stable scores derived from recorded child output. */
export function PromptEvaluations({
  project,
  busy,
  finalize,
  openSession,
}: {
  project: ProjectRecord
  busy: boolean
  finalize: (id: EvaluationId) => Promise<void>
  openSession: (id: SessionId) => void
}): ReactElement {
  const openExecution = (id: SessionId): (() => void) => () =>{  openSession(id) }
  const verdict = (value: boolean | null): string => (value === null ? 'Unknown' : value ? 'Pass' : 'Fail')
  return (
    <section>
      <h4>Prompt evaluations</h4>
      <p>
        Run the same saved cases from your project conversation to compare prompt revisions. Missing usage and
        incomplete output remain unknown.
      </p>
      {project.evaluations.length === 0 && <p>No evaluations recorded.</p>}
      {project.evaluations.map((evaluation) => {
        const prompt = project.prompts.find(item => item.id === evaluation.promptId)
        const revision = prompt?.revisions.find(item => item.revision === evaluation.promptRevision)
        const run = project.runs.find(item => item.id === evaluation.runId)
        return (
          <article key={evaluation.id}>
            <strong>
              {prompt?.name} · Revision {evaluation.promptRevision}
            </strong>
            <p>
              {run?.state} · {evaluation.result ? verdict(evaluation.result.accepted) : 'Awaiting scored results'}
            </p>
            {!evaluation.result && (run?.state === 'completed' || run?.state === 'failed') && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void finalize(evaluation.id)
                }}
              >
                Score recorded results
              </button>
            )}
            {evaluation.result && (
              <table>
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Acceptance</th>
                    <th>JSON validity</th>
                    <th>Latency (ms)</th>
                    <th>Measured tokens</th>
                    <th>Execution</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluation.result.cases.map((result) => {
                    const step = run?.steps.find(item => item.stepId === result.stepId)
                    const specification = revision?.evaluationCases.find(item => item.id === result.caseId)
                    return (
                      <tr key={result.caseId}>
                        <th>{specification?.name ?? result.caseId}</th>
                        <td>
                          {verdict(result.accepted)}
                          {result.outputTruncated && ' (incomplete output)'}
                          {result.error && <p>{result.error}</p>}
                        </td>
                        <td>
                          {specification?.checks.validJson === undefined
                            ? 'Not requested'
                            : result.validJson === null
                              ? 'Unknown'
                              : result.validJson
                                ? 'Valid'
                                : 'Invalid'}
                        </td>
                        <td>{result.latencyMs ?? 'Unknown'}</td>
                        <td>{result.tokens ?? 'Unknown'}</td>
                        <td>
                          {step?.sessionId && (
                            <button
                              type="button"
                              onClick={openExecution(step.sessionId)}
                            >
                              Open execution
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </article>
        )
      })}
    </section>
  )
}
