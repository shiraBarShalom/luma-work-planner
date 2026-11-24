// Clock abstraction. Production reads the device clock; tests inject a fixed instant.
let source = () => Date.now();

export const clock = {
  /** @returns {number} epoch milliseconds */
  ms: () => source(),
  /** @returns {Date} */
  now: () => new Date(source()),
  /** ISO-8601 UTC instant for audit timestamps. */
  iso: () => new Date(source()).toISOString(),
};

/** Test hook: replace the time source. Pass null to restore the device clock. */
export function setClockSource(fn) {
  source = typeof fn === 'function' ? fn : () => Date.now();
}
