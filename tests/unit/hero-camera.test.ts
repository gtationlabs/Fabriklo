import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cameraTurn, focusX, turnPoses } from "@/lib/cms/hero-camera";

describe("store tour camera", () => {
  it("reads the focus point X", () => {
    expect(focusX("40% 50%")).toBe(40);
    expect(focusX("100% 0%")).toBe(100);
    expect(focusX("garbage")).toBe(50);
  });

  it("turns toward the next scene's focus point", () => {
    expect(cameraTurn("40% 50%")).toBe(-1);
    expect(cameraTurn("55% 55%")).toBe(1);
    expect(cameraTurn("50% 55%")).toBe(0);
    expect(cameraTurn("52% 50%")).toBe(0);
  });

  it("mirrors left and right turns and scales with motion strength", () => {
    const left = turnPoses(-1, 1);
    const right = turnPoses(1, 1);
    expect(left.enter.rotationY).toBe(-right.enter.rotationY);
    expect(left.leave.xPercent).toBeGreaterThan(0);
    expect(turnPoses(1, 0.5).enter.rotationY).toBe(right.enter.rotationY / 2);
    expect(turnPoses(0, 1).enter.z).toBeLessThan(0);
    expect(turnPoses(0, 1).leave.z).toBeGreaterThan(0);
  });
});

describe("built-in tour", () => {
  it("has all five store scenes, so an unseeded database still gets the full walkthrough", async () => {
    const { FALLBACK_SCENES } = await import("@/lib/cms/hero-fallback");
    expect(FALLBACK_SCENES).toHaveLength(5);
    for (const s of FALLBACK_SCENES) {
      expect(existsSync(`public${s.image_path}`)).toBe(true);
      expect(s.object_position).toMatch(/^\d{1,3}% \d{1,3}%$/);
    }
    expect(FALLBACK_SCENES.map((s) => s.position)).toEqual([1, 2, 3, 4, 5]);
  });
});
