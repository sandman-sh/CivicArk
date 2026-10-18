# Arkiv Developer Friction Report (`/arkiv/friction.md`)

This report provides reproducible technical feedback on building with the Arkiv SDK (`@arkiv-network/sdk` v0.8.1) and the **Tiramisu Testnet** (Chain ID: `7738577`).

---

## Issue 1: Unfiltered Queries Throw Execution Error (Absence of `match-all` Syntax)

### Surface
TypeScript SDK (`@arkiv-network/sdk`), Query Engine (`SelectQueryBuilder`).

### Expected Behavior
In SQL and most ORMs/graph builders, calling `.select().fetch()` or `.select().limit(10).fetch()` without a `.where()` clause retrieves the first $N$ entities ordered by block height or key.

### Actual Behavior
Executing:
```typescript
const res = await publicClient
  .select({ key: true, attributes: true })
  .limit(10)
  .fetch();
```
Throws a runtime exception:
```
Fetch error: A query needs at least one filter — the language has no spelling for 'match every entity'. Add a where(...) predicate, or narrow by ownedBy(...) / createdBy(...).
```

### Reproducible Steps
1. Initialize `createPublicClient({ chain: tiramisu, transport: http() })`.
2. Call `.select({ key: true }).limit(5).fetch()`.
3. Notice the thrown error requiring at least one predicate.

### Impact & Solution for CivicArk
To query all records within an application, developers must introduce a common partitioning attribute (e.g. `app = str("civicark")`) across every entity and always filter with `where(eq("app", str("civicark")))`. We suggest adding a native `.all()` or `.any()` predicate or allowing unbounded `.limit()` reads.

---

## Issue 2: Node.js / Serverless LocalStorage Warning on Client Instantiation

### Surface
SDK Core / Client initialization.

### Expected Behavior
Initializing `createPublicClient` or `createWalletClient` in standard Node.js scripts or Next.js/Vite server-side environments should run without runtime experimental warnings.

### Actual Behavior
Whenever a client or query builder is invoked in Node.js (v20+ or v26+), the runtime prints:
```
(node:33552) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
```

### Cause
The SDK references global `localStorage` internally without first verifying `typeof window !== 'undefined' && window.localStorage`.

### Reproducible Steps
Run in terminal:
```bash
node -e "const { createPublicClient } = require('@arkiv-network/sdk'); const { tiramisu } = require('@arkiv-network/sdk/chains'); const { http } = require('viem'); createPublicClient({ chain: tiramisu, transport: http() });"
```

### Suggested Fix
Wrap storage access with an isomorphic storage adapter check:
```typescript
const storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;
```

---

## Issue 3: Numeric Attribute Type Casting Rigidity (`u64` vs `i32` vs `dec`)

### Surface
Attribute Module (`@arkiv-network/sdk/attr`), Query Predicates (`@arkiv-network/sdk/query`).

### Expected Behavior
A query comparing a numerical attribute (e.g., `budget_inr`) with a JavaScript number `gte("budget_inr", 1000000)` should either automatically coerce to the attribute's underlying type or provide explicit lint-time errors.

### Actual Behavior
Passing an untyped JavaScript number directly into query operators causes an `UntypedValueError` or schema mismatch error. The developer must strictly wrap every numerical argument with the exact matching helper (`u64(BigInt(val))` vs `i32(val)`). If an attribute was created as `u64`, querying with `i32` silently fails to match any entities.

### Reproducible Steps
```typescript
// Throws or yields 0 matches:
where(gte("budget_inr", 5000000)); 

// Required workaround:
where(gte("budget_inr", u64(5000000n)));
```

### Suggested Fix
Allow typed builder helpers or provide better runtime error messages that hint: *"Attribute 'budget_inr' was declared as u64; use u64(val) instead of i32."*

---

## Issue 4: Transaction Revert Without Custom Decoded Revert Data When Gas / Balance is Insufficient

### Surface
Wallet Client (`createWalletClient.createEntity`), Tiramisu RPC.

### Expected Behavior
When a wallet with 0 GLM attempts to write an entity on Tiramisu, the RPC should return a clear `InsufficientFundsError` or `GasLimitExceeded` error explaining that GLM testnet tokens are needed from the Hub faucet.

### Actual Behavior
The SDK throws a generic `EntityMutationError`:
```
EntityMutationError: Transaction failed: Execution error without revert data
```
This leaves new developers confused as to whether their payload encoding, attributes schema, or wallet balance caused the failure.

### Suggested Fix
Surface the underlying Viem / EVM error code before wrapping in `EntityMutationError`, or check balance in the client helper before dispatching.

---

## Summary Assessment
Overall, the Arkiv SDK is fast and provides a developer experience far superior to traditional Subgraphs. Query latency directly against the Tiramisu L3 DB-Chain is typically under 150ms. Addressing the four DX items above will make developer onboarding even smoother.
