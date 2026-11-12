import * as OTPAuth from "otpauth";
import { describe, expect, it } from "vitest";
import { DEMO_ACCOUNTS, DEMO_EMAIL_DOMAIN } from "@/scripts/demo-users/accounts";
import { base32Decode, hotp, secondsLeft, totp } from "@/scripts/demo-users/totp";

describe("demo TOTP helper", () => {
  it("matches the RFC 4226 HOTP test vectors", () => {
    const key = Buffer.from("12345678901234567890");
    expect([0, 1, 2, 9].map((c) => hotp(key, c))).toEqual(["755224", "287082", "359152", "520489"]);
  });

  it("decodes base32 like authenticator apps do", () => {
    expect(base32Decode("GEZDGNBVGY3TQOJQ").toString()).toBe("1234567890");
    expect(base32Decode("gezd gnbv gy3t qojq").toString()).toBe("1234567890");
  });

  it("produces the same code as the otpauth library used by the e2e tests", () => {
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const at = Date.UTC(2026, 10, 12, 7, 0, 15);
    const expected = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: at });
    expect(totp(secret, at)).toBe(expected);
    expect(secondsLeft(at)).toBe(15);
  });
});

describe("demo accounts", () => {
  it("cover owner, admin, manager, staff and customer on the reserved demo domain", () => {
    expect(DEMO_ACCOUNTS.map((a) => a.key)).toEqual(["owner", "admin", "manager", "staff", "customer"]);
    expect(DEMO_ACCOUNTS.every((a) => a.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`))).toBe(true);
    expect(DEMO_ACCOUNTS.find((a) => a.key === "customer")?.role).toBeNull();
  });
});
