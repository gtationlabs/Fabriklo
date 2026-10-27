import "server-only";
import { createFashnProvider } from "./fashn";
import { createMockTryonProvider } from "./mock";
import { selectTryonProvider, type TryonEnv } from "./select";
import type { TryonProvider } from "./types";

export { selectTryonProvider };

let mock: TryonProvider | null = null;

export function getTryonProvider(): TryonProvider | null {
  const env = process.env as TryonEnv;
  const choice = selectTryonProvider(env);
  if (choice === "fashn") return createFashnProvider({ apiKey: env.FASHN_API_KEY! });
  if (choice === "mock") return (mock ??= createMockTryonProvider());
  return null;
}

/** What the product page needs (no secrets). */
export function tryonOffer(): { label: string; isMock: boolean; disclosure: string } | null {
  const p = getTryonProvider();
  return p ? { label: p.label, isMock: p.isMock, disclosure: p.disclosure } : null;
}
