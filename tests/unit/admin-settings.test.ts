import { describe, expect, it } from "vitest";
import { auditCsv, changedKeys, maskSensitive, parseAuditFilters } from "@/lib/admin/audit";
import { DEFAULT_THEME, contrastChecks, contrastRatio, normaliseHex, themeCss, themeStyle, themeTokensSchema } from "@/lib/theme/tokens";

describe("theme tokens", () => {
  it("accepts the defaults and rejects extra keys, bad hex and unknown fonts", () => {
    expect(themeTokensSchema.safeParse(DEFAULT_THEME).success).toBe(true);
    expect(themeTokensSchema.safeParse({ ...DEFAULT_THEME, custom_css: "x" }).success).toBe(false);
    expect(themeTokensSchema.safeParse({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, paper: "red" } }).success).toBe(false);
    expect(themeTokensSchema.safeParse({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, paper: "#fff;}body{display:none" } }).success).toBe(false);
    expect(themeTokensSchema.safeParse({ ...DEFAULT_THEME, fonts: { display: "comic", body: "inter" } }).success).toBe(false);
    expect(themeTokensSchema.safeParse({ ...DEFAULT_THEME, radius: "huge" }).success).toBe(false);
  });

  it("normalises hex input", () => {
    expect(normaliseHex(" #ABC ")).toBe("#aabbcc");
    expect(normaliseHex("#A1B2C3")).toBe("#a1b2c3");
  });

  it("emits only CSS custom properties built from validated values", () => {
    const css = themeCss({ ...DEFAULT_THEME, fonts: { display: "playfair", body: "manrope" }, radius: "lg" });
    expect(css.startsWith(":root{")).toBe(true);
    expect(css).toContain("--color-bronze-strong:#7c521f");
    expect(css).toContain("--font-display:var(--font-playfair)");
    expect(css).toContain("--font-body:var(--font-manrope)");
    expect(css).toContain("--ui-radius-sm:1.000rem");
    expect(css).not.toMatch(/[<>{}]/.source.replace("{", "").replace("}", "")); // no markup
    expect(() => themeCss({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, paper: "url(x)" } } as never)).toThrow();
    const style = themeStyle(DEFAULT_THEME);
    expect(style["--color-paper"]).toBe("#fbf8f3");
  });

  it("computes WCAG contrast and flags failing pairs", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastChecks(DEFAULT_THEME).every((c) => c.ok)).toBe(true);
    const pale = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, charcoal: "#cccccc" } };
    const failing = contrastChecks(pale).filter((c) => !c.ok);
    expect(failing.map((c) => c.fg)).toContain("charcoal");
  });
});

describe("audit viewer helpers", () => {
  it("masks secret-looking keys at any depth and keeps the rest", () => {
    const masked = maskSensitive({ email: "a@b.c", confirm_token_hash: "abc", nested: { api_key: "k", name: "n", list: [{ password: "p" }] } }) as Record<string, unknown>;
    expect(masked.email).toBe("a@b.c");
    expect(masked.confirm_token_hash).toBe("•••");
    expect((masked.nested as Record<string, unknown>).api_key).toBe("•••");
    expect((masked.nested as Record<string, unknown>).name).toBe("n");
    expect(((masked.nested as Record<string, unknown>).list as Record<string, unknown>[])[0]!.password).toBe("•••");
  });

  it("lists changed top-level keys", () => {
    expect(changedKeys({ a: 1, b: 2, c: [1] }, { a: 1, b: 3, c: [1], d: null })).toEqual(["b", "d"]);
    expect(changedKeys(null, { x: 1 })).toEqual(["x"]);
  });

  it("parses filters defensively", () => {
    const f = parseAuditFilters({ entity_type: "orders", action: "status.change", actor: "not-a-uuid", from: "2026-10-01", before: "12" });
    // One bad field resets to defaults rather than throwing.
    expect(f.entity_type).toBe("");
    const ok = parseAuditFilters({ entity_type: "orders", from: "2026-10-01", before: "12" });
    expect(ok).toMatchObject({ entity_type: "orders", from: "2026-10-01", before: 12 });
    expect(parseAuditFilters({ entity_type: "orders; drop" }).entity_type).toBe("");
  });

  it("writes CSV with masking and formula protection", () => {
    const csv = auditCsv(
      [
        { id: 1, occurred_at: "2026-10-26T00:00:00Z", actor_id: "u1", actor_role: "admin", action: "=cmd()", entity_type: "site_settings", entity_id: "store.identity", reason: null, before_data: { name: "A", token_hash: "x" }, after_data: { name: "B" } },
      ],
      new Map([["u1", "Rana"]]),
    );
    const [header, row] = csv.split("\r\n");
    expect(header).toContain("changed_keys");
    expect(row).toContain('"Rana"');
    expect(row).toContain("\"'=cmd()\"");
    expect(row).toContain("•••");
    expect(row).not.toContain('"x"');
    expect(row).toContain("name token_hash");
  });
});
