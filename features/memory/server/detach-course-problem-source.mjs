const SOURCE_IDENTITY_KEYS = new Set(['sourceHash', 'uploadSourceHash']);

function detachMatchingSourceIdentity(value, sourceDigest) {
  if (Array.isArray(value)) {
    let changed = false;
    const detached = value.map((item) => {
      const result = detachMatchingSourceIdentity(item, sourceDigest);
      changed ||= result.changed;
      return result.value;
    });
    return { changed, value: detached };
  }

  if (!value || typeof value !== 'object') {
    return { changed: false, value };
  }

  let changed = false;
  const detached = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      SOURCE_IDENTITY_KEYS.has(key) &&
      typeof child === 'string' &&
      child.trim() === sourceDigest
    ) {
      changed = true;
      continue;
    }
    const result = detachMatchingSourceIdentity(child, sourceDigest);
    changed ||= result.changed;
    detached[key] = result.value;
  }
  return { changed, value: detached };
}

/**
 * Removes source identity markers that make a preserved problem look like a
 * durable artifact of an uploaded source. The detached fields deliberately do
 * not use `sourceHash` or `uploadSourceHash`, so a later upload of the same
 * source can rebuild its notebook while ordinary problem fingerprinting still
 * sees and skips the preserved question.
 */
export function detachCourseProblemSource(args) {
  const sourceDigest = args.sourceDigest.trim();
  if (!sourceDigest) {
    return { changed: false, sourceMeta: args.sourceMeta };
  }

  const detached = detachMatchingSourceIdentity(args.sourceMeta, sourceDigest);
  if (!detached.changed) {
    return { changed: false, sourceMeta: args.sourceMeta };
  }

  const root =
    detached.value && typeof detached.value === 'object' && !Array.isArray(detached.value)
      ? detached.value
      : { previousSourceMeta: detached.value };
  return {
    changed: true,
    sourceMeta: {
      ...root,
      detachedSourceDigest: sourceDigest,
      detachedSourceTitle: args.sourceTitle.trim(),
      detachedAt: args.detachedAt,
    },
  };
}

export function containsCourseSourceIdentity(value, sourceDigest) {
  if (Array.isArray(value)) {
    return value.some((item) => containsCourseSourceIdentity(item, sourceDigest));
  }
  if (!value || typeof value !== 'object') return false;

  for (const [key, child] of Object.entries(value)) {
    if (
      SOURCE_IDENTITY_KEYS.has(key) &&
      typeof child === 'string' &&
      child.trim() === sourceDigest
    ) {
      return true;
    }
    if (containsCourseSourceIdentity(child, sourceDigest)) return true;
  }
  return false;
}
