export const CREDITS_PER_DOLLAR = 100;

export function dollarsToCredits(dollars: number): number {
  return dollars * CREDITS_PER_DOLLAR;
}

export function formatCredits(credits: number): string {
  return `${Math.round(credits)} ⬡`;
}

export function formatDollarsAsCredits(dollars: number): string {
  return formatCredits(dollarsToCredits(dollars));
}
