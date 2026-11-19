import type { Doc, Id } from "../../../convex/_generated/dataModel";

/** A customer as the detail query returns it (the internal sequence key removed). */
export type CustomerDetailRow = Omit<Doc<"customers">, "codeSequenceKey"> & {
  readonly customerId: Id<"customers">;
  readonly taxIdChecksumValid?: boolean;
};

/** A likely duplicate offered while creating a customer. */
export interface SimilarCustomer {
  readonly customerId: string;
  readonly code: string;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
}
