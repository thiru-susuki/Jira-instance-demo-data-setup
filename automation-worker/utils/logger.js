export function info(message, details = null) {
  if (details) {
    console.log(`[info] ${message}`, details);
    return;
  }

  console.log(`[info] ${message}`);
}

export function warn(message, details = null) {
  if (details) {
    console.warn(`[warn] ${message}`, details);
    return;
  }

  console.warn(`[warn] ${message}`);
}

export function error(message, details = null) {
  if (details) {
    console.error(`[error] ${message}`, details);
    return;
  }

  console.error(`[error] ${message}`);
}
