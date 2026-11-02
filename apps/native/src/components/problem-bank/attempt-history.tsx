import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LocalProblemAttempt } from '../../domain/models';
import { marbleImages } from '../../lib/learning-action-marbles';
import { STATUS_MARBLES } from './answer-sheet';
import { highlightCode } from './code-answer-editor';
import { ProblemRichText } from './problem-rich-text';
import './attempt-history.css';

type Rec = Record<string, unknown>;
type CaseResult = {
  id: string;
  description?: string;
  passed: boolean;
  actual?: string;
  error?: string;
  stdout?: string;
};
type RecipeCheck = { id: string; target: string; passed: boolean; detail?: string };
type Summary = { passed: number; total: number };

const rec = (value: unknown): Rec =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {};
const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);

const STATUS_TEXT: Record<string, string> = {
  passed: '通过',
  partial: '部分对',
  failed: '错了',
  pending: '待批改',
  error: '判题异常',
};

const EVENT_TEXT: Record<string, string> = {
  solution_viewed: '看答案前的进度',
  hidden_tests_viewed: '看隐藏测试前的进度',
  answer_reset: '重置作答',
};

const RECIPE_LABELS: Record<string, string> = {
  read: '读取代码',
  signature: '签名',
  typecheck: '@typecheck',
  purpose: '目的说明',
  stub: '存根',
  data_definition: '数据定义',
  template_origin: '模板来源',
  dd_template_rules: '@dd-template-rules',
  template: '模板',
  test_validity: '测试正确',
  test_thoroughness: '测试覆盖',
};

function marbleFor(status: string) {
  const key = (status in STATUS_MARBLES ? status : 'pending') as keyof typeof STATUS_MARBLES;
  return marbleImages[status === 'error' ? 'pink' : STATUS_MARBLES[key]];
}

function percent(score: number | null | undefined) {
  return typeof score === 'number' ? `${Math.round(score * 100)}%` : '—';
}

function summaryOf(value: unknown): Summary | undefined {
  const item = rec(value);
  return typeof item.passed === 'number' && typeof item.total === 'number'
    ? { passed: item.passed, total: item.total }
    : undefined;
}

function casesOf(value: unknown): CaseResult[] {
  return Array.isArray(value)
    ? value
        .map(rec)
        .filter((item) => typeof item.passed === 'boolean')
        .map((item) => ({
          id: String(item.id ?? ''),
          description: str(item.description),
          passed: item.passed as boolean,
          actual: str(item.actual),
          error: str(item.error),
          stdout: str(item.stdout),
        }))
    : [];
}

function recipeOf(value: unknown): RecipeCheck[] {
  return Array.isArray(value)
    ? value
        .map(rec)
        .filter((item) => typeof item.passed === 'boolean' && typeof item.id === 'string')
        .map((item) => ({
          id: item.id as string,
          target: String(item.target ?? ''),
          passed: item.passed as boolean,
          detail: str(item.detail),
        }))
    : [];
}

function imagesOf(answer: Rec) {
  return (Array.isArray(answer.images) ? answer.images : [])
    .map(rec)
    .filter((image) => typeof image.dataUrl === 'string' && image.dataUrl.startsWith('data:image/'))
    .map((image) => ({
      id: String(image.id ?? image.dataUrl),
      dataUrl: image.dataUrl as string,
      name: String(image.name ?? ''),
    }));
}

function CodeView({ code, language }: { code: string; language?: string }) {
  return (
    <pre className="ah-code">
      <code>{highlightCode(code, language)}</code>
    </pre>
  );
}

function TestSummaries({ pub, secret }: { pub?: Summary; secret?: Summary }) {
  if (!pub && !secret) return null;
  return (
    <div className="ah-chips">
      {pub ? (
        <span className={pub.passed === pub.total ? 'ah-ok' : 'ah-bad'}>
          公开测试 {pub.passed}/{pub.total}
        </span>
      ) : null}
      {secret ? (
        <span className={secret.passed === secret.total ? 'ah-ok' : 'ah-bad'}>
          隐藏测试 {secret.passed}/{secret.total}
        </span>
      ) : null}
    </div>
  );
}

function FailedCases({ cases }: { cases: CaseResult[] }) {
  const failed = cases.filter((item) => !item.passed);
  if (!failed.length) return null;
  return (
    <div className="ah-block">
      <p className="ah-label">没通过的公开测试</p>
      <ul className="ah-cases">
        {failed.map((item, index) => (
          <li key={`${item.id}-${index}`}>
            <code>{item.description || item.id}</code>
            {item.actual ? <pre>实际：{item.actual}</pre> : null}
            {item.error ? <pre className="ah-error">{item.error}</pre> : null}
            {item.stdout ? <pre>{item.stdout}</pre> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecipeChecks({ checks }: { checks: RecipeCheck[] }) {
  if (!checks.length) return null;
  return (
    <div className="ah-block">
      <p className="ah-label">
        设计配方 {checks.filter((item) => item.passed).length}/{checks.length}
      </p>
      <ul className="ah-recipe">
        {checks.map((item, index) => (
          <li key={`${item.target}-${item.id}-${index}`} className={item.passed ? 'ok' : 'bad'}>
            <img src={marbleImages[item.passed ? 'green' : 'pink']} alt="" />
            <span>
              <code>{item.target}</code> {RECIPE_LABELS[item.id] ?? item.id}
              {item.detail ? <small>{item.detail}</small> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Feedback({ text, label = '反馈' }: { text?: string; label?: string }) {
  if (!text) return null;
  return (
    <div className="ah-block ah-feedback">
      <p className="ah-label">{label}</p>
      <ProblemRichText content={text} />
    </div>
  );
}

function AnswerView({ answer, language }: { answer: Rec; language?: string }) {
  const selected = Array.isArray(answer.selectedOptionIds)
    ? answer.selectedOptionIds.filter((id): id is string => typeof id === 'string')
    : [];
  const blanks = Object.entries(rec(answer.blanks));
  const cells = Object.entries(rec(answer.cells));
  const code = str(answer.code);
  const text = str(answer.text);
  const images = imagesOf(answer);
  if (!selected.length && !blanks.length && !cells.length && !code && !text && !images.length) {
    return <p className="ah-muted">没有作答内容。</p>;
  }
  return (
    <div className="ah-answer">
      {selected.length ? (
        <div className="ah-chips">
          {selected.map((id) => (
            <span key={id}>{id}</span>
          ))}
        </div>
      ) : null}
      {blanks.length ? (
        <div className="ah-chips">
          {blanks.map(([id, value], index) => (
            <span key={id}>
              第 {index + 1} 空：{String(value || '—')}
            </span>
          ))}
        </div>
      ) : null}
      {cells.length ? (
        <table className="ah-cells">
          <tbody>
            {cells.map(([key, value]) => (
              <tr key={key}>
                <th>{key}</th>
                <td>{String(value || '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {code ? <CodeView code={code} language={language} /> : null}
      {text ? <ProblemRichText content={text} /> : null}
      {images.length ? (
        <div className="ah-photos">
          {images.map((image) => (
            <img key={image.id} src={image.dataUrl} alt={image.name} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PartsView({
  answers,
  results,
  language,
}: {
  answers: Rec;
  results: Rec[];
  language?: string;
}) {
  const labels = Array.from(
    new Set([...results.map((item) => String(item.label ?? '')), ...Object.keys(answers)]),
  ).filter(Boolean);
  const byLabel = new Map(results.map((item) => [String(item.label ?? ''), item]));
  return (
    <div className="ah-parts">
      {labels.map((label) => {
        const part = byLabel.get(label);
        const status = String(part?.status ?? 'pending');
        return (
          <section key={label}>
            <header>
              <img src={marbleFor(status)} alt="" />
              <b>({label})</b>
              <span>{STATUS_TEXT[status] ?? status}</span>
              {part && typeof part.score === 'number' ? <em>{percent(part.score)}</em> : null}
            </header>
            <AnswerView answer={rec(answers[label])} language={language} />
            <TestSummaries
              pub={summaryOf(part?.publicSummary)}
              secret={summaryOf(part?.secretSummary)}
            />
            <FailedCases cases={casesOf(part?.caseResults)} />
            <RecipeChecks checks={recipeOf(part?.designRecipe)} />
            <Feedback text={str(part?.feedback)} />
          </section>
        );
      })}
    </div>
  );
}

function AttemptDetail({ attempt, language }: { attempt: LocalProblemAttempt; language?: string }) {
  const answer = rec(attempt.answer);
  const result = rec(attempt.result);
  const server = rec(result.serverCodeResult);
  const partResults = Array.isArray(result.parts) ? result.parts.map(rec) : [];
  if (answer.kind === 'parts' || partResults.length) {
    return (
      <div className="ah-detail">
        <PartsView answers={rec(answer.parts)} results={partResults} language={language} />
        <Feedback text={str(result.feedback)} label="总评" />
      </div>
    );
  }
  const cases = casesOf(server.publicCases).length
    ? casesOf(server.publicCases)
    : casesOf(server.caseResults);
  return (
    <div className="ah-detail">
      <div className="ah-block">
        <p className="ah-label">我的提交</p>
        <AnswerView answer={answer} language={language} />
      </div>
      <TestSummaries
        pub={summaryOf(server.publicSummary)}
        secret={summaryOf(server.secretSummary)}
      />
      <FailedCases cases={cases} />
      <RecipeChecks checks={recipeOf(server.designRecipe)} />
      <Feedback text={str(result.feedback) ?? str(server.feedback)} />
      <Feedback text={str(server.analysis) ?? str(result.analysis)} label="批改说明" />
      {str(result.aiGradingError) ? (
        <p className="ah-muted">AI 批改没完成：{String(result.aiGradingError)}</p>
      ) : null}
    </div>
  );
}

/** 「记录」：每次作答一行，点开看提交内容、测试、设计配方和批改反馈。 */
export function AttemptHistory({
  attempts,
  language,
}: {
  attempts: LocalProblemAttempt[];
  /** 代码的语言（python / racket） */
  language?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(attempts[0]?.id ?? null);
  const submissions = attempts.filter((item) => !item.result?.event);
  return (
    <section className="local-attempt-history ah">
      <h3>本机作答记录</h3>
      {attempts.slice(0, 20).map((attempt) => {
        const event = typeof attempt.result?.event === 'string' ? attempt.result.event : null;
        const number = event ? null : submissions.length - submissions.indexOf(attempt);
        const open = openId === attempt.id && !event;
        return (
          <article key={attempt.id} className={open ? 'is-open' : undefined}>
            <button
              type="button"
              className="ah-row"
              disabled={Boolean(event)}
              aria-expanded={event ? undefined : open}
              onClick={() => setOpenId(open ? null : attempt.id)}
            >
              <img src={marbleFor(event ? 'pending' : attempt.status)} alt="" />
              <span className="ah-title">
                <strong>
                  {event
                    ? (EVENT_TEXT[event] ?? event)
                    : `#${number} · ${STATUS_TEXT[attempt.status] ?? attempt.status}`}
                </strong>
                <small>{new Date(attempt.createdAt).toLocaleString()}</small>
              </span>
              {event ? null : <em>{percent(attempt.score)}</em>}
              {event ? null : <ChevronDown className="ah-chevron" size={16} />}
            </button>
            {open ? <AttemptDetail attempt={attempt} language={language} /> : null}
          </article>
        );
      })}
    </section>
  );
}
