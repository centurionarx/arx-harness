# Resend identity delivery

This reference owns the external delivery adapter. It registers exactly one provider on `ctx.webIdentity`; config requires an explicit private `keyFile` and fixed `from`. It reads no environment or model-provider credential service, accepts no recipient override and exposes no inbox/webhook/HTTP/model tool. [The identity provider](../web-identity-sqlite/README.md) owns encrypted outbox persistence, purpose-bound tokens and cancellation.

POSTs go only to `https://api.resend.com/emails` with the registered recipient, private authorization header, AbortSignal and operation-specific idempotency key. [Resend retains idempotency keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys); retry TTL is bounded accordingly. Provider acceptance is recorded separately from recipient delivery.

Links use canonical deployment origins and `#reset=` or `#invite=` fragments. The browser removes the fragment before rendering, and only POST consumes the token. Keys and links never enter adapter logs or admin responses. A recipient's established recovery email cannot be rewritten by MASTER.

Unit fixtures replace only the external fetch boundary and send no email. Real sender/domain/key configuration and recipient delivery require distinct operational authorization under [the deployment proposal](../../../.agents/notes/proposed/architecture/2026-10-08-native-web-authority-and-owned-control-plane.md).

## Model Experience

### Transactional identity delivery

#### What the model sees

`ResendIdentityDelivery` delivers identity invitations and password recovery messages. Delivery bodies are not agent prompts, tool results or conversation events.

#### Token effect

Zero direct request-token effect. Model-facing consumers retain ownership of their existing messages and schemas.

#### KV Cache effect

This package contributes no model-visible request prefix or cache-key mutation.

## Known Limitations and Deferred Work

- Delivery requires an operator-configured API credential and a verified sender. Disposable transport fixtures do not establish real deliverability or provider configuration.
