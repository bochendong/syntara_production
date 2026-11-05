/** Treat a wheel burst, including its inertial tail, as a single chapter step. */
export function createWheelGesture() {
  let lastAt = -Infinity;
  let accumulated = 0;
  let consumed = false;

  return (delta: number, now: number, navigating: boolean): -1 | 0 | 1 => {
    if (!delta) return 0;
    if (now - lastAt > 200) {
      accumulated = 0;
      consumed = false;
    }
    lastAt = now;
    if (navigating) consumed = true;
    if (consumed) return 0;
    if (Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
    accumulated += delta;
    if (Math.abs(accumulated) < 24) return 0;
    consumed = true;
    return accumulated > 0 ? 1 : -1;
  };
}

export function swipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dy) < 48 || Math.abs(dy) <= Math.abs(dx)) return 0;
  return dy < 0 ? 1 : -1;
}
