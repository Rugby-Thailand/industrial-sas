# Barcode and identifier processing manual

Status: **Domain library.** Normalization, GS1 parsing, internal LPN generation and
validation, bare SSCC handling, and deterministic scan resolution are implemented and
tested. No scanner adapter, item lookup endpoint, label UI, or persisted scan workflow
exists yet.

## Who this is for

- Developers integrating HID or camera scanners
- Master-data owners defining SKU/GTIN/LPN policies
- Operators and support staff interpreting scan rejection codes

## Resolution order

`resolveScan` classifies one raw value using this policy-controlled ladder:

1. GS1 element string;
2. internal LPN;
3. bare SSCC, only when enabled;
4. GTIN;
5. SKU fallback, enabled by default.

It returns exactly one interpretation or a structured rejection. It never guesses
between multiple valid meanings.

## Supported GS1 Application Identifiers

| AI   | Meaning              |
| ---- | -------------------- |
| `00` | SSCC                 |
| `01` | GTIN                 |
| `10` | Batch/lot            |
| `11` | Production date      |
| `15` | Best-before date     |
| `17` | Expiration date      |
| `21` | Serial               |
| `30` | Variable count       |
| `37` | Count of trade items |

Supported symbology identifiers are GS1-128 (`]C1`), GS1 DataMatrix (`]d2`), GS1
QR (`]Q3`), and GS1 DataBar (`]e0`). Variable-length fields must use correct FNC1
termination. Unsupported AIs fail closed.

## Normalization rules

- Preserve leading zeros in GTIN, SSCC, SKU, and lot values.
- Normalize Unicode where the specific identifier contract permits it.
- Do not uppercase lot codes automatically; lot case is significant.
- Reject control characters and overlong values.
- Validate GTIN/SSCC check digits before accepting them.

## Internal LPNs

Internal LPN generation requires a validated organization namespace, an injected
clock, and an injected entropy source. The check character detects every
single-character substitution and adjacent transposition covered by the tested
alphabet.

Namespace policy is mandatory to accept an internal LPN. If a scan looks like an
internal LPN but its namespace is unknown or its check character is damaged, reject
it instead of reinterpreting it as a SKU or GTIN.

## Scanner integration procedure

1. Capture the raw scanner value unchanged.
2. Build a policy with an explicit reference year, tenant LPN namespaces, bare-SSCC
   setting, and SKU fallback setting.
3. Call `resolveScan(raw, policy)`.
4. On success, retain both `raw` and the normalized interpretation.
5. Resolve interpreted GTIN/SKU/LPN values to tenant master data through bounded,
   tenant-scoped reads.
6. On failure, show a translated message from the rejection code and keep the raw
   value only according to the approved data-retention policy.

## Common rejections

- `INVALID_GS1_SCAN`: the value identifies itself as GS1 but has invalid content.
- `LPN_NAMESPACE_POLICY_MISSING`: no tenant policy can decide ownership.
- `FOREIGN_LPN_NAMESPACE`: a valid LPN belongs to another namespace.
- `INVALID_LPN_SCAN`: the value claims a known namespace but is damaged.
- `BARE_SSCC_DISABLED`: syntactically valid SSCC is not allowed by tenant policy.
- `AMBIGUOUS_SCAN`: more than one bare interpretation is valid.
- `UNRECOGNIZED_SCAN`: no enabled interpretation accepted the value.

Do not fall through after a fatal GS1/LPN/SSCC rejection. That would convert a damaged
or foreign identifier into plausible local stock.

## Known limitations

- The repository has no real supplier-label corpus yet.
- AI `21` parses, but serial workflows remain disabled.
- Internal LPN uniqueness/never-reuse requires persistence that is not implemented.
- No item barcode lookup or device capture adapter is wired.

## Implementation references

- `convex/model/identifiers/normalization.ts`
- `convex/model/identifiers/lpn.ts`
- `convex/model/identifiers/scanResolution.ts`
- `convex/model/gs1/checkDigit.ts`
- `convex/model/gs1/date.ts`
- `convex/model/gs1/elementString.ts`
- [Device capture contract](../integration-contracts/device-capture-adapters.md)
