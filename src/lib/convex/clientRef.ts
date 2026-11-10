import type {
  DefaultFunctionArgs,
  FunctionReference,
  FunctionReturnType,
  FunctionType,
  FunctionVisibility,
} from "convex/server";
import type { GenericId } from "convex/values";

type ClientValue<Value> =
  Value extends GenericId<string>
    ? string
    : Value extends readonly (infer Item)[]
      ? readonly ClientValue<Item>[]
      : Value extends object
        ? { readonly [Key in keyof Value]: ClientValue<Value[Key]> }
        : Value;

// Use the typed adapter for validated feature interfaces. Raw route/scanner
// text is still checked by the registered server validator; an ID that already
// carries a table brand cannot silently become an unrelated table's ID.
type UnvalidatedIdInput = string & { readonly __tableName?: never };
type TypedClientInput<Value> =
  Value extends GenericId<infer Table>
    ? GenericId<Table> | UnvalidatedIdInput
    : Value extends readonly (infer Item)[]
      ? readonly TypedClientInput<Item>[]
      : Value extends object
        ? { readonly [Key in keyof Value]: TypedClientInput<Value[Key]> }
        : Value;
type TypedClientResult<Value> =
  Value extends GenericId<string>
    ? Value
    : Value extends readonly (infer Item)[]
      ? readonly TypedClientResult<Item>[]
      : Value extends object
        ? { readonly [Key in keyof Value]: TypedClientResult<Value[Key]> }
        : Value;

type ClientReference<Reference, TypedIds extends boolean = false> =
  Reference extends FunctionReference<
    infer Type,
    infer Visibility,
    infer Args,
    infer Result,
    infer ComponentPath
  >
    ? FunctionReference<
        Type,
        Visibility,
        TypedIds extends true ? TypedClientInput<Args> : ClientValue<Args>,
        TypedIds extends true ? TypedClientResult<Result> : ClientValue<Result>,
        ComponentPath
      >
    : never;

type AnyReference = FunctionReference<
  FunctionType,
  FunctionVisibility,
  DefaultFunctionArgs,
  unknown
>;

export const clientRef = <Reference extends AnyReference>(
  reference: Reference,
): ClientReference<Reference> =>
  reference as unknown as ClientReference<Reference>;

/** Preserves document ID brands for newly validated feature interfaces. */
export const typedClientRef = <Reference extends AnyReference>(
  reference: Reference,
): ClientReference<Reference, true> =>
  reference as unknown as ClientReference<Reference, true>;

export type RefValue<Reference extends AnyReference> =
  FunctionReturnType<Reference> extends infer Outcome
    ? Outcome extends { readonly ok: true; readonly value: infer Value }
      ? Value
      : never
    : never;

export type RefPageItem<Reference extends AnyReference> =
  RefValue<Reference> extends infer Page
    ? Page extends {
        readonly ok: true;
        readonly items: readonly (infer Item)[];
      }
      ? Item
      : never
    : never;
