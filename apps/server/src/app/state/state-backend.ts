export const STATE_BACKENDS = [
  "memory",
  "redis"
] as const;

export type StateBackend = (typeof STATE_BACKENDS)[number];

export const parseStateBackend = (value: string | undefined): StateBackend => {
  if (!value) {
    return "memory";
  }

  if (STATE_BACKENDS.includes(value as StateBackend)) {
    return value as StateBackend;
  }

  throw new Error(
    `Unsupported STATE_BACKEND "${value}". Expected one of: ${STATE_BACKENDS.join(", ")}.`
  );
};
