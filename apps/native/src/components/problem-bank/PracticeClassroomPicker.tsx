import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, GraduationCap } from 'lucide-react';
import {
  getTeachClass,
  getTeachHome,
  getTeachSession,
  teachSessionAction,
  type TeachClass,
} from '../../data/platform-api-client';
import { classSessionLabel } from '../../lib/class-session-label';

type Classroom = TeachClass['sessions'][number];

const isEditable = (status: string) => status === 'draft' || status === 'live';

function lastClassroom(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function rememberClassroom(key: string, sessionId: string) {
  try {
    window.localStorage.setItem(key, sessionId);
  } catch {
    // 加题仍可用。
  }
}

export function PracticeClassroomPicker({
  teacherId,
  courseId,
  problemId,
}: {
  teacherId: string;
  courseId: string;
  problemId: string;
}) {
  const key = `syntara.practice-classroom.v1:${teacherId}:${courseId}`;
  const [classrooms, setClassrooms] = useState<Classroom[] | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const home = await getTeachHome();
        const currentClass = home.courses.find((course) => course.id === courseId)?.currentClass;
        const overview = currentClass?.mine ? await getTeachClass(currentClass.id) : null;
        if (!active) return;
        const options = (overview?.sessions ?? [])
          .filter(({ status }) => isEditable(status))
          .sort((a, b) => b.number - a.number);
        const last = lastClassroom(key);
        setClassrooms(options);
        setSelectedId(options.find(({ id }) => id === last)?.id ?? options[0]?.id ?? '');
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '课堂暂时无法读取。');
      }
    })();
    return () => {
      active = false;
    };
  }, [courseId, key]);

  const chooseClassroom = (id: string) => {
    rememberClassroom(key, id);
    setSelectedId(id);
  };

  return (
    <div className="pp-classroom-picker" role="group" aria-label="课堂加题">
      <ClassroomDropdown
        classrooms={classrooms ?? []}
        selectedId={selectedId}
        placeholder={error ? '无法读取课堂' : classrooms ? '暂无可加题的课堂' : '正在读取课堂…'}
        onChange={chooseClassroom}
      />
      <AddToClassroomButton
        key={selectedId}
        sessionId={selectedId}
        problemId={problemId}
        onAdd={() => rememberClassroom(key, selectedId)}
      />
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

function ClassroomStatus({ status }: { status: string }) {
  return (
    <span className="pp-classroom-status" data-live={status === 'live' ? '' : undefined}>
      {status === 'live' ? '上课中' : '备课'}
    </span>
  );
}

function ClassroomDropdown({
  classrooms,
  selectedId,
  placeholder,
  onChange,
}: {
  classrooms: Classroom[];
  selectedId: string;
  placeholder: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = classrooms.find(({ id }) => id === selectedId);
  const label = selected ? classSessionLabel(selected) : placeholder;

  useLayoutEffect(() => {
    if (!open) return;
    const current = list.current?.querySelector<HTMLButtonElement>(
      '[role="option"][aria-selected="true"]',
    );
    (current ?? list.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('focusin', closeOnOutside);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('focusin', closeOnOutside);
    };
  }, [open]);

  const closeAndFocusTrigger = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div
      ref={anchor}
      className="pp-classroom-dropdown"
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeAndFocusTrigger();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="pp-classroom-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`选择课堂：${label}${selected ? (selected.status === 'live' ? '，上课中' : '，备课') : ''}`}
        title={label}
        disabled={!classrooms.length}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <GraduationCap size={15} className="pp-classroom-icon" aria-hidden />
        <span className="pp-classroom-name">{label}</span>
        {selected ? <ClassroomStatus status={selected.status} /> : null}
        <ChevronDown className="pp-classroom-chevron" size={14} aria-hidden />
      </button>
      {open ? (
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label="选择课堂"
          className="pp-classroom-options"
          onKeyDown={(event) => {
            if (event.key === 'Tab') {
              closeAndFocusTrigger();
              return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const options = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
            );
            const index = options.findIndex((option) => option === document.activeElement);
            const step = event.key === 'ArrowDown' ? 1 : -1;
            const target =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : (index + step + options.length) % options.length;
            options[target]?.focus();
          }}
        >
          {classrooms.map((classroom) => (
            <button
              key={classroom.id}
              type="button"
              role="option"
              aria-selected={classroom.id === selectedId}
              tabIndex={-1}
              className="pp-classroom-option"
              onClick={() => {
                onChange(classroom.id);
                closeAndFocusTrigger();
              }}
            >
              <span className="pp-classroom-name">{classSessionLabel(classroom)}</span>
              <ClassroomStatus status={classroom.status} />
              {classroom.id === selectedId ? <Check size={15} aria-hidden /> : <span aria-hidden />}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AddToClassroomButton({
  sessionId,
  problemId,
  onAdd,
}: {
  sessionId: string;
  problemId: string;
  onAdd: () => void;
}) {
  const [classroomProblems, setClassroomProblems] = useState<Set<string> | null>(null);
  const [adding, setAdding] = useState(false);
  const [readError, setReadError] = useState('');
  const [addError, setAddError] = useState<{ problemId: string; message: string } | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    void getTeachSession(sessionId)
      .then(({ session, items }) => {
        if (!active) return;
        if (!isEditable(session.status)) {
          setReadError('这节课已下课，请选择其他课堂。');
          return;
        }
        setClassroomProblems(new Set(items.map((item) => item.problemId)));
      })
      .catch((cause) => {
        if (active) {
          setReadError(cause instanceof Error ? cause.message : '课堂题单暂时无法读取。');
        }
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  const added = classroomProblems?.has(problemId);
  const error = readError || (addError?.problemId === problemId ? addError.message : '');

  const add = async () => {
    if (!classroomProblems || added || adding) return;
    onAdd();
    setAdding(true);
    setAddError(null);
    try {
      const result = await teachSessionAction({
        action: 'add',
        sessionId,
        problemIds: [problemId],
      });
      if (!result.items.some((item) => item.problemId === problemId)) {
        throw new Error('课堂题单未更新，请重试。');
      }
      setClassroomProblems(new Set(result.items.map((item) => item.problemId)));
    } catch (cause) {
      setAddError({
        problemId,
        message: cause instanceof Error ? cause.message : '加题失败，请重试。',
      });
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="pp-run-button pp-classroom-add"
        disabled={!classroomProblems || added || adding}
        aria-busy={adding || (Boolean(sessionId) && !classroomProblems && !readError)}
        aria-live="polite"
        onClick={() => void add()}
      >
        {adding ? '加入中…' : added ? '已加入' : '加到课堂'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
