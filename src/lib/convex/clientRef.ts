import type {
  DefaultFunctionArgs,
  FunctionReference,
  FunctionType,
  FunctionVisibility,
} from "convex/server";
import type { GenericId } from "convex/values";

/**
 * Present Convex document IDs as strings at the browser boundary.
 *
 * IDs are strings on the wire, while preview data and route parameters are not
 * backed by a live Convex database and therefore cannot carry Convex's brand.
 * This keeps that representation choice in one place without duplicating the
 * generated function arguments and return types.
 */
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
