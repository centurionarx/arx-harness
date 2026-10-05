import { expect, it } from 'vitest'
import {
  authorizationDescribeValueSchema, authorizationBeginRequestSchema, authorizationBeginValueSchema,
  authorizationSubmitRequestSchema, authorizationSubmitValueSchema, authorizationPollRequestSchema,
  authorizationPollValueSchema, authorizationCancelRequestSchema, authorizationCancelValueSchema,
} from '@arx-ai/arx-host-apiproxy/api/authorization.schema'
import { attempt, flow } from './fixtures.client.ts'

it('uses real generic authorization wire schemas and UUID prompt/attempt capabilities', () => {
  expect(authorizationDescribeValueSchema.safeParse({ flows: [flow] }).success).toBe(true)
  expect(authorizationBeginRequestSchema.safeParse({ key: flow.key, method: 'pat' }).success).toBe(true)
  const values = [
    authorizationBeginValueSchema, authorizationSubmitValueSchema, authorizationPollValueSchema, authorizationCancelValueSchema,
  ]
  for (const schema of values) {
    expect(schema.safeParse({ attempt }).success).toBe(true)
  }
  const request = { attemptId: attempt.id, promptId: attempt.prompt!.id, answer: 'unit-only-private-answer' }
  expect(authorizationSubmitRequestSchema.safeParse(request).success).toBe(true)
  expect(authorizationSubmitRequestSchema.safeParse({ ...request, promptId: 'invalid-capability' }).success).toBe(false)
  expect(authorizationPollRequestSchema.safeParse({ attemptId: attempt.id }).success).toBe(true)
  expect(authorizationCancelRequestSchema.safeParse({ attemptId: attempt.id }).success).toBe(true)
})
