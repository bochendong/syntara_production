import { useEffect, useState } from 'react';
import type {
  BankComparison,
  BankComparisonGroup,
  ComparisonMetric,
} from '../../../../../lib/problem-bank/bank-comparison';
import { getNativeBankComparison } from '../../data/platform-api-client';
import { platformAvailable } from '../../data/browser-runtime';
import type { NativeClassStanding } from '../../data/platform-api-contracts';
import { marbleImages, type MarbleColor } from '../../lib/learning-action-marbles';

const percent = (n: number | null) => (n === null ? '—' : Math.round(n * 100) + '%');
const clamp = (n: number) => Math.min(100, Math.max(0, n * 100));

/** 一根玻璃管：蓝弹珠是我，绿线是中位数，浅绿是中间一半同学。 */
function CompareTube({
  name,
  metric,
  compact = false,
}: {
  name: string;
  metric: ComparisonMetric;
  compact?: boolean;
}) {
  return (
    <div className={`ba-compare${compact ? ' is-compact' : ''}`}>
      <div className="ba-compare-head">
        <strong>{name}</strong>
        <span>
          我 {percent(metric.me)} · 中位 {percent(metric.median)}
        </span>
      </div>
      <div className="ba-compare-tube" aria-hidden>
        {metric.lower != null && metric.upper != null && (
          <i
            className="ba-band"
            style={{
              left: `${clamp(metric.lower)}%`,
              width: `${clamp(metric.upper - metric.lower)}%`,
            }}
          />
        )}
        {metric.median !== null && (
          <i className="ba-median" style={{ left: `${clamp(metric.median)}%` }} />
        )}
        {metric.me !== null && (
          <img
            className="ba-me"
            src={marbleImages.blue}
            alt=""
            style={{ left: `${clamp(metric.me)}%` }}
          />
        )}
      </div>
    </div>
  );
}

/** 一句话结论：刷题量和第一次就做对跟中位数比。 */
function verdict(data: BankComparison) {
  const { coverage, firstTry } = data;
  const ahead = (m: ComparisonMetric) =>
    m.me === null || m.median === null ? null : m.me - m.median;
  const more = ahead(coverage);
  const accurate = ahead(firstTry);
  if (more === null) return { text: '先做几道题，再来比比看', mood: 'blue' as MarbleColor };
  if (more > 0.05 && (accurate ?? 0) >= -0.05)
    return { text: '比一半同学刷得多', mood: 'green' as MarbleColor };
  if (more > 0.05) return { text: '刷得多，第一次做对还能再稳一点', mood: 'amber' as MarbleColor };
  if (more < -0.05) return { text: '比中位数少刷了一些，追一追', mood: 'pink' as MarbleColor };
  return { text: '和大部分同学差不多', mood: 'blue' as MarbleColor };
}

export function BankPeerComparison({
  courseId,
  group,
  groups = [],
  preview,
}: {
  courseId: string;
  group: BankComparisonGroup;
  /** 题库的章 / 套，用来给知识点配上同色弹珠。 */
  groups?: { title: string; color: MarbleColor | null }[];
  preview?: BankComparison;
}) {
  const [data, setData] = useState<BankComparison | NativeClassStanding | null>(preview ?? null);
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (preview || !platformAvailable()) return;
    let active = true;
    void getNativeBankComparison(courseId, group)
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [courseId, group, attempt, preview]);
  if (!preview && !platformAvailable())
    return <p className="ba-note">这门本地课程暂无同学统计。</p>;
  if (failed)
    return (
      <div className="ba-detail">
        <p>暂时无法读取同学统计。</p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            retry((n) => n + 1);
          }}
        >
          重试
        </button>
      </div>
    );
  if (!data) return <p role="status">正在读取同学统计…</p>;
  if (data.scope !== 'store-term') return <p role="status">当前服务暂未提供本学期商城加课统计。</p>;
  const cohortLabel = `${data.termLabel} · ${data.enrollmentCount} 位同学 · 匿名`;
  if (!data.peerCount)
    return (
      <>
        <p className="ba-note">{cohortLabel}</p>
        <p>本学期暂无其他商城学员可供对比。</p>
      </>
    );
  const summary = verdict(data);
  const colorOf = (name: string) => groups.find((item) => item.title === name)?.color ?? 'blue';
  return (
    <>
      <div className={`ba-verdict is-${summary.mood}`}>
        <img src={marbleImages[summary.mood]} alt="" />
        <span>
          <strong>{summary.text}</strong>
          <small>{cohortLabel}</small>
        </span>
      </div>
      <CompareTube name="刷题覆盖率" metric={data.coverage} />
      <CompareTube name="第一次就做对" metric={data.firstTry} />
      <p className="ba-key">
        <span>
          <img src={marbleImages.blue} alt="" />我
        </span>
        <span>
          <i className="is-median" />
          中位数
        </span>
        <span>
          <i className="is-band" />
          中间一半同学
        </span>
      </p>
      {data.topics.length ? (
        <>
          <h3>
            <span>各{group === 'chapters' ? '章' : '套'}第一次就做对</span>
            <small>我 / 中位</small>
          </h3>
          <ul className="ba-topics">
            {data.topics.map((topic) => (
              <li key={topic.name}>
                <img src={marbleImages[colorOf(topic.name)]} alt="" />
                <span className="ba-topic-copy">
                  <span>{topic.name}</span>
                  <span className="ba-mini-tube is-compare" aria-hidden>
                    <i className="is-blue" style={{ width: `${clamp(topic.firstTry.me ?? 0)}%` }} />
                    {topic.firstTry.median !== null && (
                      <b style={{ left: `${clamp(topic.firstTry.median)}%` }} />
                    )}
                  </span>
                </span>
                <small
                  className={
                    topic.firstTry.me !== null &&
                    topic.firstTry.median !== null &&
                    topic.firstTry.me < topic.firstTry.median
                      ? 'is-behind'
                      : ''
                  }
                >
                  {percent(topic.firstTry.me)} / {percent(topic.firstTry.median)}
                </small>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
