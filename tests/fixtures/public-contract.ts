/**
 * Old-client compatibility rules for registered Convex functions.
 *
 * A deployed backend serves every open browser tab, including tabs still
 * running the previous frontend. Those tabs call public functions by name with
 * the argument shapes they were built with and read the result fields they
 * know. The snapshot in `public-function-contract.json` records the exported
 * validators of every registered function; this module decides whether the
 * current validators remain compatible with that snapshot.
 *
 * Rules for a public function (internal functions only need a reviewed
 * snapshot refresh):
 *  - it must still exist and stay public, with the same kind;
 *  - its arguments must accept every value the old arguments accepted
 *    (no removed field, no new required field, no narrowed type);
 *  - its result must stay within what old clients could read (no removed or
 *    newly optional field, no widened type); new result fields are allowed.
 */

export type ExportedValidator =
  | { readonly type: "any" | "null" | "number" | "bigint" | "boolean" }
  | { readonly type: "string" | "bytes" }
  | { readonly type: "literal"; readonly value: unknown }
  | { readonly type: "id"; readonly tableName: string }
  | { readonly type: "array"; readonly value: ExportedValidator }
  | {
      readonly type: "record";
      readonly keys: ExportedValidator;
      readonly values: { readonly fieldType: ExportedValidator };
    }
  | { readonly type: "union"; readonly value: readonly ExportedValidator[] }
  | {
      readonly type: "object";
      readonly value: Readonly<
        Record<
          string,
          { readonly fieldType: ExportedValidator; readonly optional: boolean }
        >
      >;
    };

export interface FunctionContract {
  readonly kind: "query" | "mutation" | "action";
  readonly visibility: "public" | "internal";
  readonly args: ExportedValidator;
  readonly returns: ExportedValidator;
}

export type ContractSnapshot = Readonly<Record<string, FunctionContract>>;

interface Mode {
  /** Result objects may gain fields; argument objects may not lose them. */
  readonly extraFieldsAllowed: boolean;
}

/**
 * Does `wide` accept every value that `narrow` accepts? Conservative: when the
 * answer cannot be proven structurally it is `false`, which asks for review.
 */
export function accepts(
  wide: ExportedValidator,
  narrow: ExportedValidator,
  mode: Mode,
): boolean {
  if (wide.type === "any") return true;
  if (narrow.type === "union") {
    return narrow.value.every((member) => accepts(wide, member, mode));
  }
  if (wide.type === "union") {
    return wide.value.some((member) => accepts(member, narrow, mode));
  }
  if (narrow.type === "any") return false;
  if (wide.type !== narrow.type) {
    // A literal is accepted by its primitive type.
    if (narrow.type === "literal") {
      const value = narrow.value;
      return (
        (wide.type === "string" && typeof value === "string") ||
        (wide.type === "number" && typeof value === "number") ||
        (wide.type === "boolean" && typeof value === "boolean") ||
        (wide.type === "bigint" && typeof value === "bigint")
      );
    }
    return false;
  }
  switch (wide.type) {
    case "literal":
      return (
        JSON.stringify(wide.value) ===
        JSON.stringify((narrow as typeof wide).value)
      );
    case "id":
      return wide.tableName === (narrow as typeof wide).tableName;
    case "array":
      return accepts(wide.value, (narrow as typeof wide).value, mode);
    case "record": {
      const other = narrow as typeof wide;
      return (
        accepts(wide.keys, other.keys, mode) &&
        accepts(wide.values.fieldType, other.values.fieldType, mode)
      );
    }
    case "object": {
      const other = narrow as typeof wide;
      for (const [name, field] of Object.entries(other.value)) {
        const target = wide.value[name];
        if (target === undefined) {
          if (!mode.extraFieldsAllowed) return false;
          continue;
        }
        if (field.optional && !target.optional) return false;
        if (!accepts(target.fieldType, field.fieldType, mode)) return false;
      }
      for (const [name, field] of Object.entries(wide.value)) {
        if (!(name in other.value) && !field.optional) return false;
      }
      return true;
    }
    default:
      return true;
  }
}

export function breakingChanges(
  previous: ContractSnapshot,
  current: ContractSnapshot,
): string[] {
  const problems: string[] = [];
  for (const [name, before] of Object.entries(previous)) {
    if (before.visibility !== "public") continue;
    const after = current[name];
    if (after === undefined) {
      problems.push(`${name}: public function removed`);
      continue;
    }
    if (after.visibility !== "public") {
      problems.push(`${name}: public function became internal`);
    }
    if (after.kind !== before.kind) {
      problems.push(`${name}: kind changed ${before.kind} -> ${after.kind}`);
    }
    // Arguments sent by an old client must still validate.
    if (!accepts(after.args, before.args, { extraFieldsAllowed: false })) {
      problems.push(
        `${name}: arguments no longer accept every old-client call`,
      );
    }
    // Every result the new server returns must still read as an old result.
    if (!accepts(before.returns, after.returns, { extraFieldsAllowed: true })) {
      problems.push(`${name}: result can now contain values old clients lack`);
    }
  }
  return problems;
}

interface RegisteredFunctionLike {
  readonly isQuery?: boolean;
  readonly isMutation?: boolean;
  readonly isAction?: boolean;
  readonly isPublic?: boolean;
  readonly isInternal?: boolean;
  readonly exportArgs: () => string;
  readonly exportReturns: () => string;
}

function isRegistered(value: unknown): value is RegisteredFunctionLike {
  if (typeof value !== "function" && typeof value !== "object") return false;
  if (value === null) return false;
  const candidate = value as Partial<RegisteredFunctionLike>;
  return (
    (candidate.isQuery === true ||
      candidate.isMutation === true ||
      candidate.isAction === true) &&
    typeof candidate.exportArgs === "function"
  );
}

/** Build a snapshot from `{ "dir/module": moduleExports }`. */
export function snapshotOf(
  modules: Readonly<Record<string, Record<string, unknown>>>,
): ContractSnapshot {
  const entries: [string, FunctionContract][] = [];
  for (const [modulePath, exports] of Object.entries(modules)) {
    for (const [exportName, value] of Object.entries(exports)) {
      if (!isRegistered(value)) continue;
      entries.push([
        `${modulePath}:${exportName}`,
        {
          kind: value.isQuery
            ? "query"
            : value.isMutation
              ? "mutation"
              : "action",
          visibility: value.isPublic ? "public" : "internal",
          args: JSON.parse(value.exportArgs()) as ExportedValidator,
          // Convex exports `null` when no `returns` validator was declared.
          returns: (JSON.parse(
            value.exportReturns(),
          ) as ExportedValidator | null) ?? {
            type: "any",
          },
        },
      ]);
    }
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}
