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

type ClientReference<Reference> =
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
        ClientValue<Args>,
        ClientValue<Result>,
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
