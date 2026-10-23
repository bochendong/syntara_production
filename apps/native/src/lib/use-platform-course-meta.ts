import { useEffect, useState } from 'react';
import {
  readPlatformCourseMeta,
  subscribePlatformCourseMeta,
  type PlatformCourseMeta,
} from './platform-course-meta';

export function usePlatformCourseMeta(): Record<string, PlatformCourseMeta> {
  const [meta, setMeta] = useState(readPlatformCourseMeta);
  useEffect(() => subscribePlatformCourseMeta(() => setMeta(readPlatformCourseMeta())), []);
  return meta;
}
