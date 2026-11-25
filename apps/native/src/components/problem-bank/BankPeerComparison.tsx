import { useEffect, useState } from 'react';
import type {
  BankComparison,
  BankComparisonGroup,
  ComparisonMetric,
} from '../../../../../lib/problem-bank/bank-comparison';
import { getNativeBankComparison } from '../../data/platform-api-client';
import { platformAvailable } from '../../data/browser-runtime';
import type { NativeClassStanding } from '../../data/platform-api-contracts';

const percent = (n: number | null) => (n === null ? '—' : Math.round(n * 100) + '%');
type Axis = { name: string; mine: number | null; peers: number | null };

function CompareBar({
  name,
  mine,
  peers,
  reference,
  range,
}: {
  name: string;
  mine: number | null;
  peers: number | null;
  reference: string;
  range?: ComparisonMetric;
}) {
  return (
    <div className="ba-compare-bar">
      <strong>{name}</strong>
      <div className="ba-scale" aria-hidden>
        {range?.lower != null && range.upper != null && (
          <i
            className="ba-range"
            style={{ left: percent(range.lower), width: percent(range.upper - range.lower) }}
          />
        )}
        {peers !== null && <i className="ba-peer-mark" style={{ left: percent(peers) }} />}
        {mine !== null && <i className="ba-my-mark" style={{ left: percent(mine) }} />}
      </div>
      <div className="ba-values">
        <span>我 {percent(mine)}</span>
        <span>
          {reference} {percent(peers)}
        </span>
      </div>
    </div>
  );
}

function Radar({
  axes,
  reference,
  title,
  description,
}: {
  axes: Axis[];
  reference: string;
  title: string;
  description: string;
}) {
  const point = (i: number, rate: number) => {
    const angle = (i * Math.PI * 2) / axes.length - Math.PI / 2;
    return [150 + Math.cos(angle) * 88 * rate, 117 + Math.sin(angle) * 88 * rate];
  };
  const polygon = (r: number) => axes.map((_, i) => point(i, r).join(',')).join(' ');
  return (
    <figure className="ba-radar">
      <figcaption>
        <strong>{title}</strong>
        <span className="ba-radar-key">
          <i />我 <i />
          {reference}
        </span>
      </figcaption>
      <svg viewBox="0 0 300 234" role="img" aria-label={title + '，详细数值见下表'}>
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <polygon key={r} points={polygon(r)} fill="none" stroke="#dbe3f1" />
        ))}
        {axes.map((a, i) => {
          const [x, y] = point(i, 1);
          const [tx, ty] = point(i, 1.16);
          return (
            <g key={a.name}>
              <line x1="150" y1="117" x2={x} y2={y} stroke="#dbe3f1" />
              <text
                x={tx}
                y={ty}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#475569"
                fontSize="13"
              >
                {a.name.length <= 6 ? a.name : i + 1}
              </text>
            </g>
          );
        })}
        {(['peers', 'mine'] as const).map((key) => {
          const color = key === 'mine' ? '#2563eb' : '#0f937d';
          return (
            <g key={key}>
              {axes.every((a) => a[key] !== null) && (
                <polygon
                  points={axes.map((a, i) => point(i, a[key]!).join(',')).join(' ')}
                  fill={color}
                  fillOpacity=".09"
                  stroke={color}
                  strokeWidth="2"
                />
              )}
              {axes.some((a) => a[key] === null) &&
                axes.map((a, i) => {
                  const next = (i + 1) % axes.length;
                  const from = a[key],
                    to = axes[next][key];
                  if (from === null || to === null) return null;
                  const [x1, y1] = point(i, from),
                    [x2, y2] = point(next, to);
                  return (
                    <line
                      key={a.name}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={color}
                      strokeWidth="2"
                    />
                  );
                })}
              {axes.map((a, i) => {
                if (a[key] === null) return null;
                const [cx, cy] = point(i, a[key]);
                return (
                  <circle key={a.name} cx={cx} cy={cy} r={key === 'mine' ? 3 : 4} fill={color} />
                );
              })}
            </g>
          );
        })}
      </svg>
      <table>
        <thead>
          <tr>
            <th>维度</th>
            <th>我</th>
            <th>{reference}</th>
          </tr>
        </thead>
        <tbody>
          {axes.map((a, i) => (
            <tr key={a.name}>
              <th>
                {i + 1}. {a.name}
              </th>
              <td>{percent(a.mine)}</td>
              <td>{percent(a.peers)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ba-note">
        {description}
        {axes.some((a) => a.mine === null || a.peers === null) ? ' — 表示数据不足。' : ''}
      </p>
    </figure>
  );
}

export function BankPeerComparison({
  courseId,
  group,
}: {
  courseId: string;
  group: BankComparisonGroup;
}) {
  const [data, setData] = useState<BankComparison | NativeClassStanding | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!platformAvailable()) return;
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
  }, [courseId, group, attempt]);
  if (!platformAvailable()) return <p>这门本地课程暂无商城加课统计。</p>;
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
  const reference = '同学中位数';
  const cohortLabel = `${data.termLabel} · 从商城加入本课 ${data.enrollmentCount} 人`;
  if (!data.peerCount)
    return (
      <>
        <p className="ba-note">{cohortLabel}</p>
        <p>本学期暂无其他商城学员可供对比。</p>
      </>
    );
  return (
    <>
      <p className="ba-note">{cohortLabel}</p>
      <CompareBar
        name="刷题覆盖率"
        mine={data.coverage.me}
        peers={data.coverage.median}
        range={data.coverage}
        reference={reference}
      />
      <p className="ba-note">蓝点代表我，绿线标出中位数，浅绿区间涵盖中间 50% 的同学。</p>
      {data.topics.length >= 3 && (
        <Radar
          title="知识点雷达图"
          description="各轴表示对应章节的首次正确率。"
          axes={data.topics.map((t) => ({
            name: t.name,
            mine: t.firstTry.me,
            peers: t.firstTry.median,
          }))}
          reference={reference}
        />
      )}
    </>
  );
}
