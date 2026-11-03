import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import {
  getCourseAiRules,
  saveCourseAiRules,
  type CourseAiRulePack,
} from '../data/platform-api-client';
import { marbleImages } from '../lib/learning-action-marbles';
import { GlassSkeletonRows } from './GlassLoadMore';
import './course-ai-rules.css';

type Draft = { key: string; id?: string; content: string };

const keyOf = () => Math.random().toString(36).slice(2);
const toDrafts = (pack: CourseAiRulePack): Draft[] =>
  pack.rules.map((rule) => ({ key: rule.id, id: rule.id, content: rule.content }));
const same = (left: Draft[], right: Draft[]) =>
  left.length === right.length &&
  left.every((rule, index) => rule.id === right[index].id && rule.content === right[index].content);

/**
 * 课程管理「AI 规则」：这门课助教每次回答都会读的规则包（作答格式、语法范围等）。
 * 一张卡一条规则，第一行当标题；改完点保存，学生下一次提问就生效。
 */
export function CourseAiRulesView({
  courseId,
  onDirtyChange,
}: {
  courseId: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [pack, setPack] = useState<CourseAiRulePack | null>(null);
  const [saved, setSaved] = useState<Draft[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const focusKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setError('');
    getCourseAiRules(courseId)
      .then((result) => {
        if (!active) return;
        setPack(result);
        setSaved(toDrafts(result));
        setDrafts(toDrafts(result));
      })
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : '读取失败'));
    return () => {
      active = false;
    };
  }, [courseId, revision]);

  const dirty = !same(drafts, saved);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const update = (key: string, content: string) =>
    setDrafts((current) => current.map((rule) => (rule.key === key ? { ...rule, content } : rule)));
  const move = (index: number, delta: number) =>
    setDrafts((current) => {
      const next = [...current];
      const [rule] = next.splice(index, 1);
      next.splice(index + delta, 0, rule);
      return next;
    });
  const add = () => {
    const key = keyOf();
    focusKey.current = key;
    setDrafts((current) => [...current, { key, content: '' }]);
  };
  const save = async () => {
    if (saving) return;
    const rules = drafts
      .map((rule) => ({ id: rule.id, content: rule.content.trim() }))
      .filter((rule) => rule.content);
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await saveCourseAiRules(courseId, rules);
      setPack(result);
      setSaved(toDrafts(result));
      setDrafts(toDrafts(result));
      setNotice('已保存，学生下一次提问就会用上。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!pack && !error) return <GlassSkeletonRows rows={3} height={120} />;
  const limit = pack?.limit ?? 30;
  const maxChars = pack?.maxChars ?? 1000;
  const tooLong = drafts.some((rule) => rule.content.trim().length > maxChars);

  return (
    <section className="tcv-panel car-panel" aria-label="AI 规则">
      <div className="car-bar">
        <p className="cp-muted">
          这门课的助教每次回答都会先读这些规则，优先于笔记和它自己的习惯。第一行当标题。
        </p>
        <div className="car-actions">
          {dirty ? (
            <button
              type="button"
              className="tcv-ghost"
              disabled={saving}
              onClick={() => setDrafts(saved)}
            >
              放弃修改
            </button>
          ) : null}
          <button
            type="button"
            className="tcv-primary"
            disabled={!dirty || saving || tooLong}
            onClick={() => void save()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
      {error ? (
        <div className="phone-page-error" role="alert">
          {error}
          {!pack ? (
            <button type="button" onClick={() => setRevision(revision + 1)}>
              重试
            </button>
          ) : null}
        </div>
      ) : null}
      {notice && !dirty ? (
        <p className="tcv-notice" role="status">
          {notice}
        </p>
      ) : null}
      {pack && !drafts.length ? (
        <button type="button" className="car-empty" onClick={add}>
          <img src={marbleImages.purple} alt="" />
          <strong>还没有规则</strong>
          <span>加一条，比如作答格式或者能用的语法</span>
        </button>
      ) : null}
      <ol className="car-list">
        {drafts.map((rule, index) => {
          const length = rule.content.trim().length;
          return (
            <li key={rule.key} className="car-card">
              <div className="car-card-head">
                <img src={marbleImages.purple} alt="" />
                <strong>规则 {index + 1}</strong>
                <span className={length > maxChars ? 'car-count is-over' : 'car-count'}>
                  {length}/{maxChars}
                </span>
                <button
                  type="button"
                  aria-label="上移"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={15} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="下移"
                  disabled={index === drafts.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={15} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="删除这条规则"
                  onClick={() =>
                    setDrafts((current) => current.filter((item) => item.key !== rule.key))
                  }
                >
                  <Trash2 size={15} aria-hidden />
                </button>
              </div>
              <textarea
                ref={(node) => {
                  if (node && focusKey.current === rule.key) {
                    focusKey.current = null;
                    node.focus();
                  }
                }}
                value={rule.content}
                rows={Math.min(14, Math.max(4, rule.content.split('\n').length + 1))}
                placeholder="例如：每个函数都要写带 >>> 例子的 docstring。"
                onChange={(event) => update(rule.key, event.target.value)}
              />
            </li>
          );
        })}
      </ol>
      {drafts.length && drafts.length < limit ? (
        <button type="button" className="tcv-ghost car-add" onClick={add}>
          <Plus size={15} aria-hidden />
          添加规则
        </button>
      ) : null}
    </section>
  );
}
