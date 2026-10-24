import {
  BookOpen,
  Brain,
  FileQuestion,
  FolderUp,
  Presentation,
  Target,
  type LucideIcon,
} from 'lucide-react';
import type { CourseLearningPage } from '../lib/native-launch';
import './learning-tool-icon.css';

const icons: Record<CourseLearningPage, LucideIcon> = {
  materials: FolderUp,
  notes: BookOpen,
  progress: Target,
  memory: Brain,
  classroom: Presentation,
  problems: FileQuestion,
};

/** Shared line icons for browser and native learning-tool entry points. */
export function LearningToolIcon({
  tool,
  size = 18,
  fallback,
}: {
  tool: string;
  size?: number;
  fallback?: LucideIcon;
}) {
  const Icon = Object.hasOwn(icons, tool) ? icons[tool as CourseLearningPage] : fallback;
  return Icon ? (
    <Icon
      className="learning-tool-icon"
      size={size}
      strokeWidth={1.8}
      aria-hidden="true"
      focusable="false"
    />
  ) : null;
}
