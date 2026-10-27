/**
 * Browser-side helpers for forms that submit with fetch instead of a server
 * action. (Server-action forms need nothing: the token is a hidden input.)
 */
export const TURNSTILE_FIELD = "cf-turnstile-response";

declare global {
  interface Window {
    turnstile?: { reset: (widget?: string | HTMLElement) => void };
  }
}

/** Token from the widget inside `form`, or undefined when Turnstile is off. */
export function turnstileToken(form: HTMLFormElement): string | undefined {
  const v = new FormData(form).get(TURNSTILE_FIELD);
  return typeof v === "string" && v ? v : undefined;
}

/** A token is single-use: reset the widget after any failed submission. */
export function resetTurnstile(form?: HTMLFormElement | null) {
  try {
    const widget = form?.querySelector<HTMLElement>(".cf-turnstile") ?? undefined;
    if (widget) window.turnstile?.reset(widget);
  } catch {
    /* widget not mounted */
  }
}
