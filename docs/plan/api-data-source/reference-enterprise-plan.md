# GenUI Playground --- API Provider Implementation Plan

**Status:** Proposed implementation plan\
**Scope:** End-to-end API data-source support for generated
applications\
**Primary architecture decisions:** - API calls execute exclusively on
the server. - The app creator owns and configures the app's API
connections by default. - Individual app users consume only the
functionality and data the published app is authorized to expose; they
do not configure or receive the creator's credentials. - Public
unauthenticated APIs are the first release; authenticated and private
APIs are introduced in later phases. - Private APIs are reached through
a customer-managed connector/agent, not by allowing arbitrary
private-network access from a shared outbound proxy. - API definitions
and allowed operations are explicit, validated, versioned declarations.
Runtime calls cannot supply arbitrary URLs or override methods and
credentials.

------------------------------------------------------------------------

## 1. Goals and non-goals

### Goals

1.  Let an app creator connect a generated application to an external
    REST API.
2.  Bind UI components to API-backed data, such as an e-shop product
    list.
3.  Keep credentials, privileged network access, and API execution on
    the server.
4.  Separate API definitions, app connections, operation permissions,
    and end-user authorization.
5.  Start with public, unauthenticated, read-only APIs and incrementally
    add API keys, bearer tokens, OAuth 2.0, private APIs, and write
    operations.
6.  Provide predictable validation, errors, limits, observability, and
    tests.
7.  Prevent SSRF, credential leakage, cross-tenant data access, unsafe
    caching, and unauthorized mutations.

### Non-goals for the initial release

-   Arbitrary JavaScript execution inside the API integration runtime.
-   Browser-side API calls that include credentials.
-   Arbitrary user-supplied URLs or HTTP methods at invocation time.
-   Direct access from the shared API worker to customer private IP
    ranges.
-   Automatically exposing every operation in an imported API
    definition.
-   Treating the app creator's connection as authorization to read any
    individual end user's private data.
-   Unbounded response bodies, pagination, retries, or execution time.

## 2. Core user and security model

### Roles

-   **Platform operator:** Operates GenUI Playground infrastructure,
    policy enforcement, secret storage, quotas, and audit systems.
-   **App creator:** Configures an app's API definitions, connections,
    allowed operations, data bindings, and publication settings.
-   **Individual app user:** Uses the published application and can
    invoke only the published capabilities allowed for that user.
-   **Customer network administrator:** Installs and manages a
    connector/agent for private infrastructure, where applicable.

### E-shop example

The creator configures a connection to their product service and enables
a declared `listProducts` operation. The published e-shop invokes that
operation through the GenUI backend. The backend uses the creator's
credential server-side and returns the approved product data to the
browser. Shoppers never see or configure the API key.

For customer-specific resources---such as order history, saved
addresses, or account details---the runtime must enforce end-user
identity and resource-level authorization. It must not assume that the
creator's API credential makes every record safe to expose. Prefer APIs
that enforce per-user authorization or a trusted backend policy that
derives the customer identity from the authenticated session. Never
accept a user ID from the UI as sufficient authorization.

### Mandatory invariants

1.  Secrets never appear in generated specs, browser bundles, client
    state, logs, analytics, error messages, or API responses.
2.  The server derives the current app user and tenant from the
    authenticated session; it does not trust client-supplied identity
    fields.
3.  Every invocation is authorized against the app, connection,
    operation, and current publication version.
4.  A runtime invocation references a declared `operationId`; it cannot
    override the URL host, path template, HTTP method, credential, or
    arbitrary headers.
5.  Creator-owned connections are scoped to the creator and the app(s)
    explicitly authorized to use them. No cross-creator access.
6.  App publication explicitly records which connection and operations
    are enabled.
7.  Private-network access is denied from the shared outbound worker.
    Private APIs require an approved customer-managed connector/agent
    and explicit target policy.
8.  API responses are untrusted data, never executable code or trusted
    instructions.
9.  Cache entries, logs, and rate limits are scoped to the appropriate
    tenant, app, connection, and---when data is user-specific---end
    user.
10. Mutations are opt-in per operation and have stricter authorization,
    confirmation, idempotency, and audit requirements.

## 3. Conceptual architecture

``` text
Generated UI in browser
  └─ sends operationId + validated parameters
       ↓
Authenticated GenUI API gateway
  ├─ derives user / tenant from session
  ├─ validates app publication and operation authorization
  ├─ applies quotas, schema validation, and request limits
  └─ calls operation runtime
       ↓
Operation runtime
  ├─ loads immutable, versioned operation definition
  ├─ resolves authorized app connection
  ├─ asks credential broker for a short-lived secret reference
  ├─ applies destination / egress policy
  └─ dispatches request
       ├─ public API → isolated outbound HTTP worker
       └─ private API → authenticated customer-managed connector
       ↓
Response validation / normalization / redaction
       ↓
Browser receives approved data or safe structured error
```

### Main services

-   **API Definition Registry:** Stores validated API base URLs,
    operation paths, HTTP methods, parameter schemas, response schemas,
    authentication requirements, version, and risk metadata.
-   **Connection Manager:** Stores creator-owned connection metadata and
    encrypted credential references. Secrets are never returned after
    initial submission.
-   **Credential Broker / Secret Store:** Encrypts credentials at rest,
    controls access, supports rotation and revocation, and provides
    credentials only to authorized execution paths.
-   **Operation Runtime:** Executes a declared operation after policy
    and schema checks.
-   **Egress Policy Service:** Validates destination hosts and resolved
    IPs, restricts redirects, and blocks unsafe destinations.
-   **Public HTTP Worker:** Performs bounded outbound HTTPS requests in
    an isolated network environment.
-   **Private Connector Service:** Routes approved requests through an
    authenticated customer-managed agent to explicitly allowed private
    services.
-   **Response Processor:** Applies size limits, schema checks, optional
    field selection, and safe error mapping.
-   **Audit / Metrics:** Records redacted invocation metadata and
    security-relevant events without secrets or sensitive payloads.

## 4. Data model

Names are illustrative; align them with existing repository conventions.

### `ApiDefinition`

Represents a versioned API integration definition.

-   `id`
-   `ownerId` / `tenantId`
-   `name`
-   `version`
-   `baseUrl`
-   `authMode`: `none | apiKey | bearer | oauth2`
-   `status`: `draft | validated | published | disabled`
-   `createdAt`, `updatedAt`
-   `definitionHash`

The base URL is validated and controlled by the server-side definition,
not supplied on every invocation.

### `ApiOperation`

Represents one allowed operation within a definition.

-   `id`
-   `apiDefinitionId`, `apiDefinitionVersion`
-   `name`, `description`
-   `method`: `GET | POST | PUT | PATCH | DELETE`
-   `pathTemplate`
-   `pathParamsSchema`
-   `queryParamsSchema`
-   `headersAllowlist`
-   `requestBodySchema`
-   `responseSchema` (optional but recommended)
-   `requiredScopes`
-   `riskLevel`: `read | write | sensitive | destructive`
-   `idempotencyPolicy`
-   `timeoutMs`, `maxResponseBytes`
-   `enabled`

Operation declarations must reject arbitrary URL fragments, protocol
changes, unsupported headers, and ambiguous path traversal.

### `ApiConnection`

Represents the creator's connection to an API.

-   `id`
-   `ownerUserId`, `tenantId`
-   `apiDefinitionId`
-   `displayName`
-   `credentialReference` (opaque reference only)
-   `authMode`
-   `status`: `needsAuth | active | expired | revoked | error`
-   `createdAt`, `updatedAt`, `lastValidatedAt`

Credential values are held in the secret store, not in this row. Never
expose the secret reference as a usable credential or permit a client to
choose another creator's connection.

### `AppApiBinding`

Connects an application to a connection and a set of operations.

-   `id`
-   `appId`, `appVersion`
-   `apiConnectionId`
-   `allowedOperationIds`
-   `dataExposurePolicy`
-   `status`: `draft | published | disabled`
-   `createdAt`, `updatedAt`

Publishing should pin the API definition/operation versions or require a
deliberate compatibility review when they change.

### `PrivateConnector`

-   `id`
-   `ownerTenantId`
-   `displayName`
-   `status`: `pending | active | disconnected | revoked`
-   `publicKey` / certificate identity metadata
-   `allowedTargets`
-   `allowedOperationIds` or policy references
-   `lastHeartbeatAt`, `createdAt`, `updatedAt`

Do not store private-network credentials in app specs. Connector
identity must be cryptographically authenticated, revocable, and scoped
to explicit targets.

## 5. Declarative spec and runtime contract

The generated UI spec references a named data source and operation, not
a URL or credential.

### Example app-level data-source declaration

``` json
{
  "dataSources": {
    "products": {
      "provider": "api",
      "bindingId": "binding_products",
      "operationId": "listProducts",
      "parameters": {
        "limit": 24,
        "category": { "from": "state.selectedCategory" }
      },
      "responseMapping": {
        "itemsPath": "$.items"
      },
      "cachePolicy": {
        "mode": "short",
        "ttlSeconds": 60
      }
    }
  }
}
```

This is illustrative. Exact syntax should match the existing GenUI
Playground / json-render spec conventions. The spec must not contain
credentials, secret references that clients can resolve, arbitrary
endpoint URLs, or executable mapping code.

### Invocation request

``` ts
type ApiOperationRequest = {
  appId: string;
  operationId: string;
  bindingId: string;
  parameters?: Record<string, unknown>;
  body?: unknown;
};
```

The authenticated user and tenant are derived from the server session,
not supplied as trusted fields. The server resolves the binding and
connection after authorization. A client must not choose arbitrary
`connectionId`, credential reference, host, method, or headers.

### Result contract

``` ts
type ApiOperationResult<T> =
  | { ok: true; data: T; meta?: { updatedAt?: string } }
  | {
      ok: false;
      error: {
        code:
          | "AUTH_REQUIRED"
          | "FORBIDDEN"
          | "VALIDATION_ERROR"
          | "RATE_LIMITED"
          | "UPSTREAM_ERROR"
          | "TIMEOUT"
          | "UNAVAILABLE";
        message: string;
        retryable: boolean;
        requestId?: string;
      };
    };
```

Do not return stack traces, internal hostnames, upstream credentials,
raw authorization headers, or secret-store details.

### Data-source runtime state

The UI may receive safe state such as:

``` ts
type ApiDataState<T> = {
  status: "idle" | "loading" | "success" | "error";
  data?: T;
  error?: { code: string; message: string; retryable: boolean };
  updatedAt?: string;
};
```

Keep loading, error, empty, and success states explicit. Avoid showing
raw upstream error bodies to end users.

## 6. Authentication and credential handling

### Phase 1 --- no authentication

-   Support only public HTTPS endpoints that do not require credentials.
-   Permit `GET` only.
-   Reject user-supplied authorization headers and credential-like
    values.
-   Keep all requests server-side even when no secret is required.

### Phase 2 --- API keys and bearer tokens

-   The creator enters a credential through a secure connection UI.
-   Store it in a dedicated encrypted secret store; the application
    database stores only an opaque reference and metadata.
-   Support only configured injection locations, such as a designated
    header or query parameter, with header injection preferred.
-   Do not allow the UI spec or individual app users to override
    credential placement.
-   Mask credentials after save; permit replace/revoke, not read-back.
-   Validate credentials with a creator-triggered test operation,
    subject to rate limits.
-   Never attach a credential to a different host after a redirect or
    destination change.

### Phase 3 --- OAuth 2.0

-   Use Authorization Code with PKCE where applicable.
-   Validate `state`, exact redirect URIs, issuer, token endpoint,
    scopes, and callback ownership.
-   Store access and refresh tokens only in the secret store.
-   Implement expiry handling, refresh locking, revocation, and
    reconnect states.
-   Request minimum required scopes and explain them to the creator.
-   Do not support Resource Owner Password Credentials.
-   Keep tokens isolated by creator, connection, and tenant.

### Credential lifecycle

-   Create, validate, rotate, revoke, and delete credentials.
-   Revoke application access when a connection or app binding is
    disabled.
-   Avoid secrets in logs, tracing, telemetry, exception objects, crash
    reports, and support exports.
-   Use envelope encryption/KMS or an equivalent managed secret-store
    design; restrict decryption to the credential broker/runtime
    identity.
-   Add automated secret scanning and tests that assert credential
    values never appear in API responses or logs.

## 7. Private APIs: customer-managed connector/agent

The shared public HTTP worker must not be given unrestricted access to
RFC1918, loopback, link-local, cloud metadata, or other internal
destinations.

### Connector behavior

1.  A customer administrator installs or runs the connector inside their
    network.
2.  The connector establishes an outbound, authenticated, encrypted
    channel to GenUI infrastructure; avoid requiring inbound firewall
    openings where possible.
3.  The administrator explicitly allowlists internal service origins and
    operation targets.
4.  GenUI authorizes a declared operation and routes it to the connector
    using an opaque connector ID.
5.  The connector validates the operation against its local policy
    before making the request.
6.  Responses return through the authenticated channel and are subject
    to the same schema, size, timeout, redaction, and authorization
    controls.
7.  The administrator can revoke the connector, rotate its identity,
    inspect audit events, and update allowed targets.

### Connector security requirements

-   Mutual TLS or equivalent strong workload authentication.
-   Short-lived/revocable connector credentials and key rotation.
-   Strict tenant binding and per-connector target allowlists.
-   No generic TCP proxy or arbitrary URL tunnel.
-   DNS and IP checks performed close to the actual connection.
-   Block loopback, link-local, cloud metadata, and destinations outside
    approved target ranges.
-   Protect against DNS rebinding and redirects to unauthorized targets.
-   Bounded payload sizes, concurrency, timeouts, and queues.
-   Signed/versioned agent releases, secure update mechanism, minimum
    supported version, and revocation.
-   Clear network/data-flow documentation for customer administrators.
-   Audit connector identity, target policy, operation ID, result
    category, latency, and request ID---without logging secrets or
    sensitive payloads by default.

## 8. Network and SSRF defenses

These are required even for public unauthenticated APIs.

-   Require HTTPS by default; enforce TLS certificate verification.
-   Normalize URLs and reject userinfo, unsupported schemes, malformed
    hosts, unexpected ports, fragments, and path traversal.
-   Resolve DNS and reject loopback, private, link-local, multicast,
    reserved, and metadata-service IP ranges for public API calls.
-   Defend against DNS rebinding by validating the address actually used
    for the connection, not only a preliminary lookup.
-   Restrict outbound traffic at the network layer as well as in
    application code.
-   Disable redirects by default. If a use case requires them,
    revalidate every hop and never forward credentials across origins.
-   Prevent arbitrary `Host`, `Authorization`, `Cookie`, forwarding, and
    hop-by-hop headers.
-   Enforce connect/read/total timeouts, maximum response bytes, maximum
    decompressed size, concurrency limits, and per-user/app/connection
    quotas.
-   Do not let API response content alter system configuration,
    operation definitions, or runtime policy.
-   Keep public and private network execution paths separate.

## 9. Operation authorization and data exposure

-   The creator explicitly enables operations for the app; importing an
    API definition does not automatically grant all operations.
-   Each operation has a declared method, path template, parameters,
    headers, request body, response schema, timeout, size limit, and
    risk level.
-   At invocation, authorize the authenticated user, app publication,
    binding, operation, connection ownership, and current status.
-   Treat the app creator's API permissions as upstream permissions, not
    as permission for all app users to access all data.
-   For shared catalog data, allow public display only when the creator
    has explicitly configured that exposure.
-   For private user-specific data, require end-user authentication and
    enforce resource-level access. Prefer upstream user-scoped OAuth
    when needed.
-   Never allow a client to submit arbitrary record IDs or account
    identifiers without a policy that verifies access.
-   Apply field allowlists or response projections for sensitive APIs.
-   Do not expose internal-only fields just because the upstream API
    returns them.
-   Require explicit publication review when adding sensitive or
    mutating operations.

## 10. HTTP methods and mutation policy

Support the method family incrementally:

  -----------------------------------------------------------------------
  Method                  Intended use            Policy
  ----------------------- ----------------------- -----------------------
  `GET`                   Read data               Phase 1

  `POST`                  Create or action        Later phase; explicit
                                                  write permission

  `PUT`                   Replace resource        Later phase; explicit
                                                  write permission

  `PATCH`                 Partial update          Later phase; explicit
                                                  write permission

  `DELETE`                Delete resource         Later phase;
                                                  sensitive/destructive
                                                  controls
  -----------------------------------------------------------------------

For write operations:

-   Declare each mutation explicitly; never enable a method globally for
    every path.
-   Validate body and parameters against schemas.
-   Enforce creator-configured operation scopes and app-level permission
    rules.
-   Use CSRF protections where cookie-based sessions apply.
-   Require confirmation for high-impact or destructive actions; support
    app-specific confirmation UX.
-   Use idempotency keys where supported.
-   Do not automatically retry non-idempotent writes unless the upstream
    API and operation provide a safe idempotency guarantee.
-   Add audit events with actor, app, operation, connection, request ID,
    result, and timestamp.
-   Apply stricter quotas and rate limits.

## 11. Response processing, cache, and pagination

### Response processing

-   Enforce content-type and response-size limits.
-   Parse only supported formats initially, preferably JSON.
-   Validate responses against declared schemas when available.
-   Normalize upstream errors into stable public error codes.
-   Treat strings and HTML in responses as untrusted content; render
    them as text or sanitize them according to the UI rendering model.
-   Never interpret response data as executable code or spec
    instructions.

### Caching

-   Start with no cache or short TTLs for public read-only data.
-   Cache keys must include app version, binding/operation version,
    connection identity, normalized parameters, and relevant
    authorization context.
-   Do not share cached results across users when data may be
    personalized or authorization-dependent.
-   Never cache secret-bearing headers or tokens.
-   Provide explicit invalidation on connection changes, revocation,
    publication updates, and permission changes.
-   Do not cache errors or sensitive responses by default.

### Pagination

-   Make pagination explicit in the operation definition.
-   Enforce maximum pages, total items, bytes, and elapsed time.
-   Never follow an upstream-provided `next` URL blindly; validate it
    against the approved origin and operation policy.
-   Support cancellation and bounded concurrency for page aggregation.

## 12. UX requirements

### Creator configuration flow

1.  Choose API provider and enter a base URL or select a validated API
    definition.
2.  Validate the base URL and explain whether it is public or requires a
    private connector.
3.  Declare or import operations; review each method, path, parameters,
    and response.
4.  Configure authentication appropriate to the API.
5.  Test an operation using a safe sample request.
6.  Preview response fields and map them to UI data.
7.  Choose cache behavior and data-exposure settings.
8.  Review security warnings and enable only required operations.
9.  Publish a pinned configuration version.
10. Manage credentials, test connection, rotate/reconnect, disable, or
    delete the connection later.

### Individual app-user experience

-   No credential setup for creator-owned connections.
-   Clear loading, empty, retry, and failure states.
-   Safe, user-friendly errors that do not reveal upstream internals.
-   End-user sign-in or consent only when a specific integration
    requires their own identity.
-   No UI controls for arbitrary endpoint, method, credential, or
    privileged headers.

### Private connector UX

-   Installation and onboarding instructions.
-   Connector online/offline/needs-update status.
-   Target allowlist management.
-   Connection test and diagnostic request IDs.
-   Revoke, rotate, and update actions.
-   Clear disclosure of what data passes through GenUI infrastructure.

## 13. Implementation phases and work items

Use task IDs in issues/PRs. Do not start later phases until the
preceding phase's acceptance criteria and security tests pass.

### Phase 0 --- Architecture and threat model

-   [ ] `API-001` Document the creator vs. app-user threat model and
    authorization boundaries.
-   [ ] `API-002` Define the data-source spec shape consistent with
    existing json-render conventions.
-   [ ] `API-003` Define API definition, operation, connection, binding,
    and connector schemas.
-   [ ] `API-004` Define operation/result/error contracts and versioning
    policy.
-   [ ] `API-005` Threat-model SSRF, credential leakage, cross-tenant
    access, cache leakage, response injection, and mutation abuse.
-   [ ] `API-006` Decide supported API definition import format and
    validation pipeline.
-   [ ] `API-007` Define limits for timeouts, response bytes,
    concurrency, quotas, and rate limiting.
-   [ ] `API-008` Define audit events, redaction policy, and retention
    requirements.

**Exit criteria:** Architecture reviewed; trust boundaries and failure
modes documented; spec and runtime contracts approved.

### Phase 1 --- Public, unauthenticated, read-only APIs

-   [ ] `API-101` Implement validated API definition and operation
    registry.
-   [ ] `API-102` Implement server-side operation invocation using
    declared `GET` operations only.
-   [ ] `API-103` Implement authenticated gateway and
    app-publication/operation authorization.
-   [ ] `API-104` Implement strict URL, DNS, IP, TLS, redirect, and
    header policy.
-   [ ] `API-105` Implement query/path parameter validation and safe
    encoding.
-   [ ] `API-106` Implement request timeouts, response byte limits,
    concurrency limits, and quotas.
-   [ ] `API-107` Implement JSON parsing, response validation, and safe
    error normalization.
-   [ ] `API-108` Implement UI data-source binding with
    loading/success/empty/error states.
-   [ ] `API-109` Implement safe cache behavior and authorization-aware
    cache keys, or disable caching initially.
-   [ ] `API-110` Add redacted audit events and request IDs.
-   [ ] `API-111` Add unit, integration, egress, and security regression
    tests.
-   [ ] `API-112` Build an example app that lists products from a public
    unauthenticated API.

**Acceptance criteria:** - A published app can display data from a
declared public HTTPS `GET` operation. - The browser calls only GenUI
endpoints; no upstream request is made directly by the browser. - The
client cannot override URL, host, method, headers, or operation ID to
execute an undeclared operation. - SSRF test cases (loopback, private,
link-local, metadata IPs, DNS rebinding, redirects, unusual URL forms)
are blocked. - Responses and logs contain no credentials or internal
stack traces. - Unauthorized users cannot invoke disabled operations or
access another tenant's bindings. - Timeout, oversized response, invalid
JSON, and upstream failure cases return safe structured errors.

### Phase 2 --- Creator-owned API keys and bearer tokens

-   [ ] `API-201` Integrate encrypted secret storage and a credential
    broker.
-   [ ] `API-202` Add secure creator-only create/replace/revoke
    credential UI.
-   [ ] `API-203` Add API-key and bearer-token modes with fixed,
    server-controlled injection rules.
-   [ ] `API-204` Enforce connection ownership and app binding
    authorization.
-   [ ] `API-205` Add creator-triggered credential validation using a
    declared test operation.
-   [ ] `API-206` Add secret rotation, revocation, and connection status
    lifecycle.
-   [ ] `API-207` Add log/trace redaction and tests for secret
    non-disclosure.
-   [ ] `API-208` Add credential isolation tests across creators,
    tenants, apps, and connections.

**Acceptance criteria:** - Only the connection owner or an explicitly
authorized tenant administrator can change credentials. - App users can
invoke only published operations; they cannot read, replace, or redirect
credentials. - Secret values never appear in specs, browser network
payloads, logs, or error messages. - Revoked credentials stop being used
for subsequent invocations.

### Phase 3 --- OAuth 2.0

-   [ ] `API-301` Implement Authorization Code + PKCE flow where
    supported.
-   [ ] `API-302` Validate `state`, exact redirect URIs, issuer, and
    callback ownership.
-   [ ] `API-303` Securely store access/refresh tokens and implement
    refresh locking.
-   [ ] `API-304` Add minimum-scope configuration and creator consent
    UX.
-   [ ] `API-305` Implement expiry, refresh failure, reconnect, and
    revocation states.
-   [ ] `API-306` Add tests for CSRF, callback replay, wrong issuer,
    token leakage, and cross-connection isolation.
-   [ ] `API-307` Document the distinction between creator-authorized
    connections and integrations that require each end user to authorize
    their own account.

**Acceptance criteria:** - Tokens remain server-side and are isolated
per connection. - Redirect URI and state validation prevent callback
substitution and CSRF. - Token refresh is safe under concurrent
requests. - Creator OAuth grants are never silently treated as end-user
authorization.

### Phase 4 --- Private APIs through customer-managed connector

-   [ ] `API-401` Define connector protocol, identity, lifecycle, and
    compatibility policy.
-   [ ] `API-402` Build authenticated outbound connector channel and
    control-plane registration.
-   [ ] `API-403` Implement target and operation allowlists at both
    control plane and connector.
-   [ ] `API-404` Implement connector-side DNS/IP validation, TLS
    checks, timeouts, and size limits.
-   [ ] `API-405` Add connector status, heartbeat, diagnostics,
    revocation, and key rotation.
-   [ ] `API-406` Implement routing from authorized operation runtime to
    the correct connector.
-   [ ] `API-407` Add tenant-isolation, connector-impersonation, SSRF,
    DNS rebinding, and policy-bypass tests.
-   [ ] `API-408` Publish installation, update, firewall, privacy, and
    operational documentation.

**Acceptance criteria:** - The shared public worker cannot reach
customer private IP ranges. - A connector can reach only its configured
targets and declared operations. - Connector identity is authenticated,
scoped to one tenant, and revocable. - A connector cannot be used as a
generic tunnel or proxy. - Disconnected, revoked, or outdated connectors
fail safely.

### Phase 5 --- Explicit write operations

-   [ ] `API-501` Add `POST`, `PUT`, `PATCH`, and `DELETE` support
    behind per-operation declarations.
-   [ ] `API-502` Add request-body schemas and validation.
-   [ ] `API-503` Add operation risk levels, write permissions, and
    publication review.
-   [ ] `API-504` Add confirmation requirements for
    sensitive/destructive operations.
-   [ ] `API-505` Add idempotency support and safe retry rules.
-   [ ] `API-506` Add stricter quotas and mutation audit events.
-   [ ] `API-507` Test unauthorized mutations, replay, duplicate
    submissions, and privilege escalation.

**Acceptance criteria:** - No write operation is callable unless
explicitly declared and enabled. - Destructive operations require
configured safeguards. - Non-idempotent operations are not blindly
retried. - Audit events identify the actor, app, operation, connection,
request ID, and outcome without logging secrets.

### Phase 6 --- Hardening and production readiness

-   [ ] `API-601` Conduct independent security review and penetration
    testing.
-   [ ] `API-602` Add rate-limit dashboards, latency/error metrics, and
    anomaly alerts.
-   [ ] `API-603` Verify tenant-safe caching and invalidation under
    publication/credential changes.
-   [ ] `API-604` Add load tests for concurrency, large responses, and
    upstream slowdowns.
-   [ ] `API-605` Test secret-store outage, connector outage, API
    outage, and partial deployment failures.
-   [ ] `API-606` Add kill switches for API execution, individual
    connections, operations, and connectors.
-   [ ] `API-607` Document incident response, credential compromise,
    audit access, and customer notification procedures.
-   [ ] `API-608` Complete privacy/data-retention review and production
    rollout plan.

**Exit criteria:** Security sign-off, operational alerts, documented
rollback, incident procedures, and successful regression/load testing.

## 14. Test strategy

### Unit tests

-   URL canonicalization and destination validation.
-   Operation schema validation and parameter encoding.
-   Authorization checks for app, connection, operation, tenant, and
    publication version.
-   Credential resolution and redaction.
-   Cache-key composition and invalidation.
-   Error normalization and response schema validation.
-   Retry and idempotency decisions.

### Integration tests

-   Public API happy path and empty result.
-   Invalid parameters, malformed JSON, unexpected content type,
    upstream 4xx/5xx, timeout, and oversized response.
-   Disabled connection, expired/revoked credential, unpublished
    operation, and stale app version.
-   Creator can configure a connection; individual app user cannot.
-   App users can browse public catalog data but cannot access creator
    settings or credentials.
-   User-specific resources are isolated across end users.
-   Private connector offline/revoked/unauthorized target cases.

### Security tests

-   SSRF to loopback, private, link-local, metadata endpoints, alternate
    IP encodings, IPv6 edge cases, and DNS rebinding.
-   Redirects to a different origin and attempts to forward credentials.
-   Host/header injection and path traversal.
-   Cross-tenant binding/connection ID substitution.
-   Credential exfiltration through errors, response data, logs,
    analytics, and tracing.
-   Cache poisoning and cross-user cache leakage.
-   Malicious API payloads attempting to inject executable UI/spec
    content.
-   Connector impersonation, replay, target-policy bypass, and arbitrary
    tunneling.
-   Unauthorized write operations, replay, and duplicate mutations.

## 15. Operational telemetry

Record structured, redacted events with:

-   Request ID and timestamp.
-   App ID/version, binding ID, operation ID, connection ID.
-   Tenant and actor identifiers according to access-controlled audit
    policy.
-   Public worker vs. connector execution path.
-   Destination host identifier (avoid logging sensitive full paths or
    query values by default).
-   Status category, latency, response byte count, retry count, and
    quota outcome.
-   Authorization denial reason category and security policy decision.

Never log credentials, authorization headers, refresh tokens, raw
request bodies, or raw response bodies by default. Any temporary
diagnostic capture must be opt-in, time-limited, access-controlled, and
redacted.

## 16. Release checklist

Before each release:

-   [ ] Schema migrations and backward compatibility verified.
-   [ ] Feature flags and emergency disable switches configured.
-   [ ] Secret scanning and dependency/security checks pass.
-   [ ] Authorization, SSRF, credential leakage, and tenant-isolation
    regression suites pass.
-   [ ] Limits and quota defaults are configured.
-   [ ] Dashboards and alerts are available.
-   [ ] User-facing documentation explains data flow and permissions.
-   [ ] Rollback procedure tested.
-   [ ] Published app behavior remains stable when a connection is
    disabled, revoked, or an upstream service fails.

## 17. Recommended initial delivery

Build Phase 0 and Phase 1 first. Keep the first release deliberately
narrow: public HTTPS, unauthenticated `GET`, explicit operations,
server-side execution, strict egress controls, bounded responses, and
safe data-source UI states. Use the e-shop product-list scenario as the
reference integration. Add credentials only after the runtime
authorization and SSRF protections are covered by automated tests. Add
private APIs through the customer-managed connector rather than relaxing
the shared worker's network policy.
