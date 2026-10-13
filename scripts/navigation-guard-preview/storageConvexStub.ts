// This credential-free browser fixture must never perform a storage write.
export function useMutation() {
  return async () => {
    throw new Error("Storage fixture writes are disabled");
  };
}
export function useQuery() {
  return undefined;
}
