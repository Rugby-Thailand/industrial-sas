import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fingerprintArguments } from "../../convex/lib/idempotency";
import {
  diffFields,
  normalizeDisplayName,
  normalizeField,
  CODE_FIELD,
  LOT_CODE_FIELD,
  MAX_DISPLAY_NAME_LENGTH,
} from "../../convex/lib/masterDataStore";

describe("code normalization", () => {
  it("is idempotent: normalizing twice changes nothing", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (raw) => {
        const once = normalizeField("code", raw, CODE_FIELD);
        if (!once.ok) return;

        const twice = normalizeField("code", once.value, CODE_FIELD);
        expect(twice.ok).toBe(true);
        expect(twice.ok && twice.value).toBe(once.value);
      }),
      { seed: 20260811, numRuns: 300 },
    );
  });

  it("accepts a padded or differently-cased form of anything it accepts", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$/),
        fc.stringMatching(/^[ \t]{0,4}$/),
        (code, padding) => {
          const plain = normalizeField("code", code, CODE_FIELD);
          const padded = normalizeField(
            "code",
            `${padding}${code.toLowerCase()}${padding}`,
            CODE_FIELD,
          );

          expect(plain.ok).toBe(true);
          expect(padded.ok).toBe(true);
          expect(padded.ok && padded.value).toBe(plain.ok && plain.value);
        },
      ),
      { seed: 20260811, numRuns: 300 },
    );
  });

  it("never answers a value containing whitespace", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (raw) => {
        const result = normalizeField("code", raw, CODE_FIELD);
        if (!result.ok) return;
        expect(/\s/.test(result.value)).toBe(false);
      }),
      { seed: 20260811, numRuns: 300 },
    );
  });

  it("never answers a value longer than the field's bound", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (raw) => {
        for (const options of [CODE_FIELD, LOT_CODE_FIELD]) {
          const result = normalizeField("code", raw, options);
          if (!result.ok) continue;
          expect(result.value.length).toBeLessThanOrEqual(options.maxLength);
        }
      }),
      { seed: 20260811, numRuns: 300 },
    );
  });

  it("preserves lot-code case, and folds ordinary code case", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/), (lower) => {
        const lot = normalizeField("lotCode", lower, LOT_CODE_FIELD);
        const code = normalizeField("code", lower, CODE_FIELD);

        expect(lot.ok && lot.value).toBe(lower);
        expect(code.ok && code.value).toBe(lower.toUpperCase());
      }),
      { seed: 20260811, numRuns: 200 },
    );
  });

  it("refuses rather than truncates, so no two codes collapse into one", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z0-9]{1,20}$/),
        fc.integer({ min: 1, max: 40 }),
        (prefix, extra) => {
          const long = prefix + "X".repeat(CODE_FIELD.maxLength + extra);
          const result = normalizeField("code", long, CODE_FIELD);
          expect(result.ok).toBe(false);
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });
});

describe("display-name normalization", () => {
  it("keeps everything but the outer whitespace", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (raw) => {
        const result = normalizeDisplayName("name", raw);
        if (!result.ok) return;
        expect(result.value).toBe(raw.trim());
      }),
      { seed: 20260811, numRuns: 300 },
    );
  });

  it("refuses a name that is only whitespace, whatever kind", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[ \t\n\r]{1,20}$/), (blank) => {
        expect(normalizeDisplayName("name", blank).ok).toBe(false);
      }),
      { seed: 20260811, numRuns: 200 },
    );
  });

  it("bounds the stored length", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (extra) => {
        const long = "ก".repeat(MAX_DISPLAY_NAME_LENGTH + extra);
        expect(normalizeDisplayName("name", long).ok).toBe(false);
      }),
      { seed: 20260811, numRuns: 100 },
    );
  });
});

describe("argument fingerprinting", () => {
  it("gives structurally equal arguments one fingerprint", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(
          fc.stringMatching(/^[a-z]{1,8}$/),
          fc.oneof(fc.string({ maxLength: 20 }), fc.integer(), fc.boolean()),
          { maxKeys: 6 },
        ),
        async (payload) => {
          const reversed = Object.fromEntries(
            Object.entries(payload).reverse(),
          );

          const left = await fingerprintArguments(payload);
          const right = await fingerprintArguments(reversed);

          expect(left.ok && right.ok).toBe(true);
          expect(left.ok && left.value).toBe(right.ok && right.value);
        },
      ),
      { seed: 20260811, numRuns: 150 },
    );
  });

  it("separates arguments that differ in any field", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[A-Z]{1,10}$/),
        fc.stringMatching(/^[A-Z]{1,10}$/),
        async (left, right) => {
          fc.pre(left !== right);

          const a = await fingerprintArguments({ sku: left });
          const b = await fingerprintArguments({ sku: right });

          expect(a.ok && b.ok).toBe(true);
          expect(a.ok && a.value).not.toBe(b.ok && b.value);
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });

  it("is always a 64-character lower-case hex digest", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
        async (payload) => {
          const result = await fingerprintArguments(payload);
          expect(result.ok && /^[0-9a-f]{64}$/.test(result.value)).toBe(true);
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });
});

describe("audit diff", () => {
  it("reports exactly the fields whose value changed", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.stringMatching(/^[a-z]{1,6}$/),
          fc.string({ maxLength: 12 }),
          { maxKeys: 5 },
        ),
        fc.dictionary(
          fc.stringMatching(/^[a-z]{1,6}$/),
          fc.string({ maxLength: 12 }),
          { maxKeys: 5 },
        ),
        (before, after) => {
          const changes = diffFields(before, after);
          const changed = new Set(changes.map((change) => change.field));

          for (const [field, next] of Object.entries(after)) {
            expect(changed.has(field)).toBe(before[field] !== next);
          }

          for (const change of changes) {
            expect(Object.hasOwn(after, change.field)).toBe(true);
          }
        },
      ),
      { seed: 20260811, numRuns: 300 },
    );
  });

  it("is empty exactly when the patch changes nothing", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.stringMatching(/^[a-z]{1,6}$/),
          fc.string({ maxLength: 12 }),
          { maxKeys: 5 },
        ),
        (record) => {
          expect(diffFields(record, record)).toEqual([]);
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });
});
