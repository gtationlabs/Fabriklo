/** Maps Postgres/PostgREST errors to safe, human messages (no SQL leaks). */
export function friendlyDbError(error: { code?: string; message?: string; hint?: string } | null | undefined): string {
  if (!error) return "Something went wrong.";
  switch (error.code) {
    case "23505":
      return /sku/i.test(error.message ?? "")
        ? "That SKU is already used."
        : /slug/i.test(error.message ?? "")
          ? "That URL slug is already used."
          : "That value is already used.";
    case "42501":
      return /approval/.test(error.message ?? "")
        ? "This adjustment is above the large-adjustment threshold and needs approval permission."
        : "You do not have permission to do that (or your MFA session expired).";
    case "23514":
      return "A value is outside the allowed range.";
    case "22023":
      return error.message && error.message.length < 120 ? capitalise(error.message) + "." : "Invalid input.";
    case "P0001":
      return error.hint === "stock_negative" || error.hint === "stock_unavailable"
        ? "Stock cannot go below the reserved/zero level."
        : "The operation was rejected.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
