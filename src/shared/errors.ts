/** The message of a thrown value, whatever was thrown. */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))
