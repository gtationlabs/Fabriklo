/** Result of an admin server action, shown next to the form. */
export type ActionState = { ok: boolean; message: string | null; secret?: string };
export const idleState: ActionState = { ok: false, message: null };

export const noAngle = (s: string) => !/[<>]/.test(s);

/** "on" checkbox → boolean. */
export const flag = (fd: FormData, name: string) => fd.get(name) === "on";

export const str = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
};
