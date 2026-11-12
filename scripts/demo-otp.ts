/**
 * Prints the current 6-digit MFA code for a demo staff account.
 *
 *   npm run demo:otp -- admin        # owner | admin | manager | staff | all
 *
 * Reads the secrets that `npm run seed:demo-users` saved to .demo-users.local.json.
 * DEV / SANDBOX ONLY.
 */
import { existsSync, readFileSync } from "node:fs";
import { DEMO_SECRETS_FILE } from "./demo-users/accounts";
import { secondsLeft, totp } from "./demo-users/totp";

type SecretsFile = { factors: Record<string, { email: string; role: string; secret: string }> };

if (!existsSync(DEMO_SECRETS_FILE)) {
  console.error(`No ${DEMO_SECRETS_FILE} here. Run \`npm run seed:demo-users\` first (from the project folder).`);
  process.exit(1);
}
const { factors } = JSON.parse(readFileSync(DEMO_SECRETS_FILE, "utf8")) as SecretsFile;
const which = (process.argv[2] ?? "all").toLowerCase();
const keys = which === "all" ? Object.keys(factors) : [which];

for (const key of keys) {
  const f = factors[key];
  if (!f) {
    console.error(`Unknown demo account "${key}". Choose one of: ${Object.keys(factors).join(", ")}, all`);
    process.exit(1);
  }
  console.log(`${key.padEnd(8)} ${totp(f.secret)}   ${f.email} (${f.role})`);
}
console.log(`\nValid for ${secondsLeft()} more seconds.`);
