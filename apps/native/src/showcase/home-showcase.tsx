/**
 * Real App pages for the public home page, filled from the bundled course
 * content. The home page embeds one view per chapter:
 *   home-showcase.html?view=problems | classroom | notes | memory | calendar
 * Everything stays in this browser's own preview database; nothing is sent
 * to the platform.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { MiniLectureClassroom } from '../components/MiniLectureClassroom';
import { PhoneNotesPage } from '../components/NotebookShelfPage';
import { PhoneCalendarPage, PhoneClassroomPage, PhoneMemoryPage } from '../components/PhonePages';
import { ProblemBankPage, type ProblemBankLaunch } from '../components/ProblemBankPage';
import { ProblemPracticePage } from '../components/ProblemPracticePage';
import { getLocalRepository } from '../data/repository';
import type { RuntimeMiniLectureDeck, LocalCourseEvent } from '../domain/learning-experiences';
import type { LocalCourseWorkspace } from '../domain/models';
import '../tailwind.css';
import '../components/marble-tokens.css';
import '../styles.css';
import '../components/compact-layout.css';
import '../components/avatar-theme.css';
import './home-showcase.css';

type View = 'problems' | 'classroom' | 'notes' | 'memory' | 'calendar';

const params = new URLSearchParams(window.location.search);
const view = (params.get('view') as View) || 'problems';

/** Which bundled course each view shows. */
const COURSE_FOR_VIEW: Record<View, string> = {
  problems: 'course-csc108-local',
  classroom: 'course-mat136-local',
  notes: 'course-csc148-local',
  memory: 'course-csc148-local',
  calendar: 'course-mat136-local',
};

/** The landing page starts the bank on a runnable code problem. */
function firstCodeProblem(workspace: LocalCourseWorkspace) {
  return (
    workspace.problems.find((p) => p.type === 'code' && p.difficulty === 'medium') ??
    workspace.problems.find((p) => p.type === 'code')
  );
}

function demoEvents(courseId: string): LocalCourseEvent[] {
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const now = Date.now();
  const make = (
    id: string,
    offset: number,
    title: string,
    kind: LocalCourseEvent['kind'],
  ): LocalCourseEvent => ({
    id: `showcase-${id}`,
    courseId,
    title,
    date: day(offset),
    note: '',
    kind,
    source: 'manual',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  return [
    make('ps', 1, 'Problem Set 6 截止', 'assignment'),
    make('review', 0, '复习：黎曼和', 'progress'),
    make('tut', 2, 'Tutorial 8：换元积分', 'tutorial'),
    make('tt', 6, 'Term Test 2', 'exam'),
    make('review2', 4, '错题重练：换元积分', 'progress'),
  ];
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="home-showcase">{children}</div>;
}

function Showcase() {
  const [workspace, setWorkspace] = useState<LocalCourseWorkspace | null>(null);
  const [launch, setLaunch] = useState<ProblemBankLaunch | null>(null);
  const [deck, setDeck] = useState<RuntimeMiniLectureDeck | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const repo = await getLocalRepository();
        await repo.bootstrap();
        const ws = await repo.loadCourseWorkspace(COURSE_FOR_VIEW[view]);
        if (cancelled || !ws) return;
        setWorkspace(ws);
        if (view === 'classroom') {
          // Open the first lecture straight away; closing it shows the lecture list.
          for (const conversation of ws.conversations) {
            const [first] = await repo.listMiniLectureDecks(conversation.id);
            if (!first) continue;
            const runtime = await repo.loadMiniLectureDeck(first.id);
            if (!cancelled && runtime) setDeck(runtime);
            break;
          }
        }
        if (view === 'problems' && params.get('start') !== 'bank') {
          const first = firstCodeProblem(ws);
          if (first) {
            const chapter = ws.problems.filter((p) => p.chapterId === first.chapterId);
            setLaunch({
              problemIds: chapter.map((p) => p.id),
              initialProblemId: first.id,
              title: first.chapterName ?? undefined,
            });
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="home-showcase-error">{error}</p>;
  if (!workspace) return <div className="home-showcase-loading" aria-busy />;
  const noop = () => undefined;

  if (view === 'problems') {
    return (
      <Shell>
        {launch ? null : (
          <div className="phone-page phone-page-overlay split-problem-bank">
            <ProblemBankPage workspace={workspace} onBack={noop} onPractice={setLaunch} />
          </div>
        )}
        {launch ? (
          <ProblemPracticePage
            problems={workspace.problems}
            launch={launch}
            onBack={() => setLaunch(null)}
          />
        ) : null}
      </Shell>
    );
  }
  if (view === 'classroom') {
    return (
      <Shell>
        <PhoneClassroomPage
          courseId={workspace.course.id}
          conversations={workspace.conversations}
          revision={0}
          loadingDeckId={null}
          onOpenDeck={(persisted) =>
            void getLocalRepository()
              .then((repo) => repo.loadMiniLectureDeck(persisted.id))
              .then(setDeck)
          }
          onOpenRemoteDeck={async () => undefined}
          onBack={noop}
        />
        <MiniLectureClassroom
          key={deck?.id ?? 'closed'}
          deck={deck}
          onClose={() => setDeck(null)}
        />
      </Shell>
    );
  }
  if (view === 'notes') {
    return (
      <Shell>
        <PhoneNotesPage workspace={workspace} onBack={noop} />
      </Shell>
    );
  }
  if (view === 'memory') {
    return (
      <Shell>
        <PhoneMemoryPage
          courseId={workspace.course.id}
          courseLabel={workspace.course.courseCode || workspace.course.name}
          notebooks={workspace.notebooks}
          memories={workspace.memories}
          focusedMemoryId={null}
          onBack={noop}
        />
      </Shell>
    );
  }
  return (
    <Shell>
      <PhoneCalendarPage
        events={demoEvents(workspace.course.id)}
        isResearchCourse={false}
        onAddEvent={noop}
        onEditEvent={noop}
        onBack={noop}
      />
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(<Showcase />);
