# CivicArk Schema Specification (`/arkiv/schema.md`)

This document outlines the entity data structures, typed attributes, time-scoped lifecycle (TTL), and query patterns used by **CivicArk** on the **Arkiv Tiramisu Testnet** (Chain ID: `7738577`).

---

## 1. Overview

CivicArk registers municipal public works contracts, contractor defect-liability guarantees, and citizen defect challenges as verifiable, wallet-owned entities on Arkiv.

Arkiv's native primitives used:
* **Typed Attributes:** High-performance indexing without external indexers (no The Graph required).
* **Time-Scoped Storage (TTL):** Entities carry an `expires` block calculated from the statutory **Defect Liability Period (DLP)**—the legal 3-to-5-year warranty during which contractors must repair defects at zero public expense.
* **Wallet-Owned Cryptographic Mutations:** Only the issuing Municipal Engineer wallet or authorized Contractor wallet can mutate (`patchEntity`) or extend (`extendEntity`) contract milestones.
* **Decentralized Public Querying:** Citizens and RTI activists query live state directly from client browsers via Tiramisu JSON-RPC.

---

## 2. Entity Types

CivicArk defines two primary entity types:

### A. `tender` (Municipal Civic Works & Warranty Entity)

Represents a public works project (road resurfacing, bridge maintenance, storm drain paving) awarded by an Indian municipal corporation (e.g. BMC Mumbai).

#### Attributes (`@arkiv-network/sdk/attr`)

| Attribute Name | Type Helper | Example Value | Description |
| :--- | :--- | :--- | :--- |
| `app` | `str` | `"civicark"` | Global application namespace for isolation |
| `type` | `str` | `"tender"` | Entity type discriminator |
| `tender_id` | `str` | `"BMC-2026-KW-RD-042"` | Official municipal tender code |
| `city` | `str` | `"Mumbai"` | Municipality city name |
| `ward` | `str` | `"K-West"` | Administrative ward (e.g. Andheri West, Juhu) |
| `road_name` | `str` | `"<road-name>"` | Physical infrastructure target |
| `category` | `str` | `"roadwork"` | Infrastructure category (`roadwork`, `drainage`, `bridge`) |
| `status` | `str` | `"warranty_active"` | Contract state (`awarded`, `in_progress`, `completed`, `warranty_active`, `breached`) |
| `budget_inr` | `u64` | `18500000n` | Total sanctioned budget in Indian Rupees (₹1.85 Cr) |
| `contractor` | `addr` | `"<contractor-wallet>"` | EVM wallet address of the awarded contractor |
| `engineer` | `addr` | `"<engineer-wallet>"` | Municipal Executive Engineer wallet address |
| `dlp_years` | `i32` | `3` | Statutory Defect Liability Period in years |
| `defect_count` | `i32` | `0` | Number of verified on-chain defect challenges logged |
| `dlp_expiry` | `u64` | `1893456000n` | Unix timestamp when the warranty expires |

#### Payload (`jsonToPayload`)
The entity payload stores verifiable audit metadata, material specifications, and cryptographic hashes of off-chain documentation:
```json
{
  "tenderId": "<municipal-tender-id>",
  "projectTitle": "<project-title>",
  "municipalBody": "<municipal-body>",
  "technicalSpecs": {
    "material": "<material-specification>",
    "thicknessMm": 0,
    "coreSampleLabCid": "ipfs://<content-id>",
    "labAccreditation": "<verified accreditation details>"
  },
  "milestones": [
    { "phase": "<milestone-name>", "signedBy": "<signer-wallet>", "timestamp": 0 }
  ]
}
```

#### Expiration (TTL)
The entity's expiration is computed from the statutory Defect Liability Period:
```typescript
// For 3-year statutory roadwork warranty on Tiramisu testnet:
const expires = ExpirationTime.fromDays(365 * 3);
```

---

### B. `defect_challenge` (Citizen Defect & Pothole Challenge Entity)

Represents an immutable, citizen-initiated defect claim against an active municipal tender during its Defect Liability Period.

#### Attributes (`@arkiv-network/sdk/attr`)

| Attribute Name | Type Helper | Example Value | Description |
| :--- | :--- | :--- | :--- |
| `app` | `str` | `"civicark"` | Global application namespace |
| `type` | `str` | `"defect"` | Entity type discriminator |
| `tender_key` | `str` | `"0x44a1...2f"` | Target Arkiv entity key of the tender |
| `ward` | `str` | `"K-West"` | Administrative ward of the reported defect |
| `severity` | `str` | `"critical"` | Severity rating (`minor`, `moderate`, `critical`, `hazardous`) |
| `reporter` | `addr` | `"0xbda5...12"` | EVM address of citizen/auditor reporting |
| `status` | `str` | `"open"` | Status (`open`, `acknowledged`, `rectified`, `breach_penalized`) |
| `timestamp` | `u64` | `1792144800n` | Report submission timestamp |

#### Expiration (TTL)
Defect challenges have a statutory 30-day contractor rectification window:
```typescript
const expires = ExpirationTime.fromDays(30);
```
If the contractor fails to rectify the defect within 30 days, the tender entity is patched to status `"breached"`.

---

## 3. Query Operations (Exact SDK Queries)

### Query 1: Fetch All Active Municipal Tenders in a Ward
Citizens filter tenders by municipal ward without relying on any centralized server:
```typescript
import { createPublicClient, str } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { eq, and } from "@arkiv-network/sdk/query";
import { http } from "viem";

const publicClient = createPublicClient({
  chain: tiramisu,
  transport: http(),
});

const result = await publicClient
  .select({ key: true, attributes: true, payload: true })
  .where(
    and(
      eq("app", str("civicark")),
      eq("type", str("tender")),
      eq("ward", str("K-West"))
    )
  )
  .limit(25)
  .fetch();
```

### Query 2: Filter by Budget and Warranty Status
Auditors track high-value infrastructure projects (> ₹1 Crore) currently under active warranty:
```typescript
import { eq, gte } from "@arkiv-network/sdk/query";
import { u64 } from "@arkiv-network/sdk/attr";

const highValueTenders = await publicClient
  .select({ key: true, attributes: true, payload: true })
  .where(
    eq("app", str("civicark")),
    eq("status", str("warranty_active")),
    gte("budget_inr", u64(10000000n))
  )
  .limit(50)
  .fetch();
```

### Query 3: Lookup Open Defect Challenges Against a Tender Key
Inspect all unresolved citizen challenges logged against a specific roadwork project:
```typescript
const challenges = await publicClient
  .select({ key: true, attributes: true, payload: true })
  .where(
    eq("app", str("civicark")),
    eq("type", str("defect")),
    eq("tender_key", str(targetTenderKey))
  )
  .fetch();
```

---

## 4. What Stays OFF Arkiv (and Why)

In accordance with the challenge guidelines and privacy compliance:
1. **Raw Drone Videos & Gigabyte Scans:** High-resolution road LiDAR surveys and multi-angle drone inspections are pinned to decentralized file storage (IPFS/Walrus). Only their cryptographic content identifiers (`ipfs://Qm...`) live on Arkiv.
2. **Citizen Private Personal Data (PII):** In compliance with the challenge disqualification criteria, **zero personal data (real Aadhaar numbers, private phone numbers, physical residential addresses) is stored on Arkiv**. Reports strictly utilize pseudonymous citizen wallet addresses and cryptographic hashes.
3. **Internal Administrative Notes:** Draft administrative deliberations are kept off-chain until formally signed by an authorized engineer wallet.
