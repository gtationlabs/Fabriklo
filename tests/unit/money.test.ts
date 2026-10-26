import { describe, expect, it } from "vitest";
import { formatBDT, parseTakaToMinor } from "@/lib/money";

describe("money", () => {
  it("formats integer poisha as BDT", () => {
    expect(formatBDT(129000)).toMatch(/1,290/);
    expect(formatBDT(129050)).toMatch(/1,290\.5/);
    expect(formatBDT(null)).toBe("");
  });

  it("parses taka input into minor units without float drift", () => {
    expect(parseTakaToMinor("1290")).toBe(129000);
    expect(parseTakaToMinor("1,290.5")).toBe(129050);
    expect(parseTakaToMinor("৳ 19.99")).toBe(1999);
    expect(parseTakaToMinor("0.1")).toBe(10);
    expect(parseTakaToMinor("-5")).toBeNull();
    expect(parseTakaToMinor("1e5")).toBeNull();
    expect(parseTakaToMinor("12.345")).toBeNull();
    expect(parseTakaToMinor("abc")).toBeNull();
  });
});
