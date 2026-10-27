import { describe, expect, it } from "vitest";
import { placeOrderSchema } from "@/lib/checkout/schema";
import { BD_DISTRICTS, BD_DIVISIONS, divisionOf, normalizeBdPhone } from "@/lib/geo/bd";
import { NEXT_STATES } from "@/lib/orders/labels";

describe("Bangladesh geography", () => {
  it("has 8 divisions and 64 districts", () => {
    expect(Object.keys(BD_DIVISIONS)).toHaveLength(8);
    expect(BD_DISTRICTS).toHaveLength(64);
    expect(divisionOf("Cox's Bazar")).toBe("Chattogram");
    expect(divisionOf("Atlantis")).toBeNull();
  });
});

describe("normalizeBdPhone", () => {
  it.each([
    ["01712345678", "+8801712345678"],
    ["017-1234-5678", "+8801712345678"],
    ["+880 1912 345678", "+8801912345678"],
    ["8801312345678", "+8801312345678"],
  ])("accepts %s", (input, out) => expect(normalizeBdPhone(input)).toBe(out));

  it.each(["01212345678", "0171234567", "+44 7700 900000", "", "phone"])("rejects %s", (input) =>
    expect(normalizeBdPhone(input)).toBeNull(),
  );
});

describe("placeOrderSchema", () => {
  const base = {
    idempotencyKey: "a".repeat(32),
    name: "Rahim Uddin",
    phone: "01712345678",
    district: "Dhaka",
    area: "Dhanmondi",
    addressLine: "House 1, Road 2",
    paymentMethod: "cod",
    expectedTotalMinor: 100000,
  };
  it("normalises the phone", () => {
    expect(placeOrderSchema.parse(base).phone).toBe("+8801712345678");
  });
  it("rejects unknown districts, online methods and bad postcodes", () => {
    expect(placeOrderSchema.safeParse({ ...base, district: "Gotham" }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...base, paymentMethod: "bkash" }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...base, postalCode: "12" }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...base, expectedTotalMinor: 10.5 }).success).toBe(false);
  });
});

describe("staff transition menu", () => {
  it("never offers 'paid' for cash on delivery", () => {
    expect(JSON.stringify(NEXT_STATES.payment_status)).not.toContain('"paid"');
  });
});
