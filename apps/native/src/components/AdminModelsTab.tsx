import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Eye, Brain, Wrench } from 'lucide-react';

import {
  saveAdminLlm,
  type AdminLlmConfig,
  type AdminModelOption,
  type AdminOverview,
} from '../data/platform-api-client';
import { marbleImages, type MarbleColor } from '../lib/learning-action-marbles';
import { PhonePage } from './PhonePages';
import './admin-models.css';

type TierId = keyof AdminLlmConfig['tierModels'];
type SlotId = 'default' | TierId;

/** 四个「位置」：全站默认 + 聊天回复强度低/中/高。 */
const SLOTS: Array<{ id: SlotId; badge: string; label: string }> = [
  { id: 'default', badge: '', label: '默认' },
  { id: 'low', badge: '低', label: '日常问答' },
  { id: 'medium', badge: '中', label: '分步讲解' },
  { id: 'high', badge: '高', label: '难题推理' },
];

/** 同一代模型同一种弹珠：GPT-6 紫，GPT-5.6 蓝，GPT-5.4 绿，其他琥珀。 */
function modelMarble(id: string): string {
  const color: MarbleColor = id.startsWith('gpt-6')
    ? 'purple'
    : id.startsWith('gpt-5.6')
      ? 'blue'
      : id.startsWith('gpt-5.4')
        ? 'green'
        : 'amber';
  return marbleImages[color];
}

function slotModel(llm: AdminLlmConfig, slot: SlotId) {
  return slot === 'default' ? llm.modelId : llm.tierModels[slot];
}

function withSlot(llm: AdminLlmConfig, slot: SlotId, modelId: string) {
  return slot === 'default'
    ? { modelId, tierModels: llm.tierModels }
    : { modelId: llm.modelId, tierModels: { ...llm.tierModels, [slot]: modelId } };
}

const compact = (value: number) =>
  value >= 1_000_000
    ? `${+(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 2)}M`
    : value >= 1000
      ? `${+(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`
      : String(value);
const usd = (value: number) =>
  `$${value >= 100 ? value.toFixed(0) : value >= 1 ? value.toFixed(2) : +value.toFixed(3)}`;

function SlotBadge({ slot, size = 'md' }: { slot: SlotId; size?: 'sm' | 'md' }) {
  const info = SLOTS.find((item) => item.id === slot)!;
  return slot === 'default' ? (
    <img className={`apm-badge is-${size} is-marble`} src={marbleImages.purple} alt="默认" />
  ) : (
    <span className={`apm-badge is-${size} ap-tier-${slot}`} aria-label={`回复强度 ${info.badge}`}>
      {info.badge}
    </span>
  );
}

type Saved = (llm: AdminLlmConfig, message: string) => void;

/** 把某个模型放到某个位置上，立刻保存。列表和详情页共用。 */
function useAssignModel(overview: AdminOverview, onSaved: Saved, onError: (m: string) => void) {
  const [busySlot, setBusySlot] = useState<SlotId | null>(null);
  const assign = async (slot: SlotId, modelId: string) => {
    const { llm, modelOptions } = overview;
    if (slotModel(llm, slot) === modelId) return;
    setBusySlot(slot);
    try {
      const next = await saveAdminLlm(withSlot(llm, slot, modelId));
      const info = SLOTS.find((item) => item.id === slot)!;
      const name = modelOptions.find((option) => option.id === modelId)?.label ?? modelId;
      onSaved(next, `${info.badge || info.label}：${name}`);
    } catch (cause) {
      onError(cause instanceof Error && cause.message ? cause.message : '保存失败');
    } finally {
      setBusySlot(null);
    }
  };
  return { busySlot, assign };
}

/**
 * 管理 → 模型：上面四个「正在用」的位置，下面所有可选模型；点模型推入详情页，
 * 在详情里看价格、上下文、本周用量，也能直接把它换到某个位置上。改动立刻保存。
 */
export function AdminModelsTab({
  overview,
  onSaved,
  onError,
  onOpen,
}: {
  overview: AdminOverview;
  onSaved: Saved;
  onError: (message: string) => void;
  /** 推入模型详情页（详情页和管理页并排渲染，盖在上面）。 */
  onOpen: (modelId: string) => void;
}) {
  const { llm, modelOptions } = overview;
  const { busySlot, assign } = useAssignModel(overview, onSaved, onError);
  const setOpenId = onOpen;
  const find = (id: string) => modelOptions.find((option) => option.id === id);
  const label = (id: string) => find(id)?.label ?? id;
  const slotsOf = (id: string) => SLOTS.filter((slot) => slotModel(llm, slot.id) === id);
  const totalRequests = modelOptions.reduce((sum, m) => sum + (m.weekUsage?.requestCount ?? 0), 0);
  const hasUsage = modelOptions.some((m) => m.weekUsage);

  return (
    <>
      <div className="apm-slots" role="list" aria-label="正在使用">
        {SLOTS.map((slot) => {
          const id = slotModel(llm, slot.id);
          return (
            <div
              key={slot.id}
              role="listitem"
              className="apm-slot"
              data-busy={busySlot === slot.id}
            >
              <div className="apm-slot-top">
                <SlotBadge slot={slot.id} size="sm" />
                <small>{slot.label}</small>
                <span className="apm-slot-switch">
                  <select
                    aria-label={`换${slot.label}模型`}
                    value={id}
                    disabled={busySlot !== null}
                    onChange={(event) => void assign(slot.id, event.target.value)}
                  >
                    {find(id) ? null : <option value={id}>{id}</option>}
                    {modelOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  换
                  <ChevronDown size={12} aria-hidden />
                </span>
              </div>
              <button type="button" className="apm-slot-model" onClick={() => setOpenId(id)}>
                <img src={modelMarble(id)} alt="" />
                <strong>{label(id)}</strong>
              </button>
            </div>
          );
        })}
      </div>

      <p className="phone-group-title">全部模型{hasUsage ? ' · 本周调用' : ''}</p>
      <div className="phone-group apm-list">
        {modelOptions.map((option) => {
          const used = slotsOf(option.id);
          const requests = option.weekUsage?.requestCount ?? 0;
          return (
            <button
              key={option.id}
              type="button"
              className="phone-row apm-row"
              data-idle={used.length === 0 || undefined}
              onClick={() => setOpenId(option.id)}
            >
              <img className="apm-row-marble" src={modelMarble(option.id)} alt="" />
              <span className="phone-row-copy">
                <strong>
                  {option.label}
                  {used.map((slot) => (
                    <SlotBadge key={slot.id} slot={slot.id} size="sm" />
                  ))}
                </strong>
                <small>{option.description}</small>
              </span>
              {hasUsage ? (
                <span className="apm-row-usage" data-zero={requests === 0 || undefined}>
                  {requests ? compact(requests) : '—'}
                  {totalRequests && requests ? (
                    <i style={{ width: `${Math.max(6, (requests / totalRequests) * 100)}%` }} />
                  ) : null}
                </span>
              ) : null}
              <ChevronRight className="apm-chevron" size={16} aria-hidden />
            </button>
          );
        })}
      </div>
      <p className="phone-group-footer">
        {llm.source === 'database' ? '管理员设置' : '环境变量默认值'}
        {llm.updatedAt ? ` · ${new Date(llm.updatedAt).toLocaleString('zh-CN')}` : ''}
      </p>
    </>
  );
}

/** 模型详情：大弹珠 + 能力，价格/上下文信息条，用在哪些位置，本周用量。 */
export function AdminModelDetail({
  overview,
  modelId,
  onSaved,
  onError,
  onBack,
}: {
  overview: AdminOverview;
  modelId: string;
  onSaved: Saved;
  onError: (message: string) => void;
  onBack: () => void;
}) {
  const { llm, modelOptions } = overview;
  const { busySlot, assign } = useAssignModel(overview, onSaved, onError);
  const model: AdminModelOption = modelOptions.find((option) => option.id === modelId) ?? {
    id: modelId,
    label: modelId,
    description: '不在可选列表里',
  };
  const label = (id: string) => modelOptions.find((option) => option.id === id)?.label ?? id;
  const totalRequests = modelOptions.reduce((sum, m) => sum + (m.weekUsage?.requestCount ?? 0), 0);
  const onAssign = (slot: SlotId) => void assign(slot, model.id);
  const usage = model.weekUsage;
  const caps = model.capabilities;
  const facts = [
    model.pricing ? { label: '输入', value: usd(model.pricing.inputUsdPerMillion) } : null,
    model.pricing
      ? { label: '缓存输入', value: usd(model.pricing.cachedInputUsdPerMillion) }
      : null,
    model.pricing ? { label: '输出', value: usd(model.pricing.outputUsdPerMillion) } : null,
    model.contextWindow ? { label: '上下文', value: compact(model.contextWindow) } : null,
    model.outputWindow ? { label: '最长输出', value: compact(model.outputWindow) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const share = usage && totalRequests ? usage.requestCount / totalRequests : 0;

  return (
    <PhonePage title={model.label} overlay onBack={onBack}>
      <div className="apm-detail">
        <header className="apm-hero">
          <img className="apm-hero-marble" src={modelMarble(model.id)} alt="" />
          <div>
            <h1>{model.label}</h1>
            <p>{model.description}</p>
            <code>{model.id}</code>
            {caps ? (
              <div className="apm-caps">
                {caps.vision ? (
                  <span>
                    <Eye size={13} aria-hidden />
                    识图
                  </span>
                ) : null}
                {caps.tools ? (
                  <span>
                    <Wrench size={13} aria-hidden />
                    工具
                  </span>
                ) : null}
                {caps.thinking ? (
                  <span>
                    <Brain size={13} aria-hidden />
                    深度思考
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        {facts.length ? (
          <>
            <div className="apm-facts" role="list">
              {facts.map((fact) => (
                <div key={fact.label} role="listitem">
                  <small>{fact.label}</small>
                  <strong>{fact.value}</strong>
                </div>
              ))}
            </div>
            {model.pricing ? <p className="apm-facts-note">官方价，美元 / 百万 token</p> : null}
          </>
        ) : null}

        <p className="phone-group-title">用在</p>
        <div className="phone-group">
          {SLOTS.map((slot) => {
            const current = slotModel(llm, slot.id);
            const active = current === model.id;
            return (
              <div key={slot.id} className="phone-row apm-use">
                <SlotBadge slot={slot.id} />
                <span className="phone-row-copy">
                  <strong>{slot.id === 'default' ? '全站默认' : slot.label}</strong>
                  {active ? null : <small>现在：{label(current)}</small>}
                </span>
                {active ? (
                  <span className="apm-on">
                    <Check size={14} strokeWidth={3} aria-hidden />
                    正在用
                  </span>
                ) : (
                  <button
                    type="button"
                    className="apm-use-button"
                    disabled={busySlot !== null}
                    onClick={() => onAssign(slot.id)}
                  >
                    {busySlot === slot.id ? '…' : '换成它'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {usage ? (
          <>
            <p className="phone-group-title">本周</p>
            <div className="apm-week">
              <div className="apm-week-tube" aria-hidden>
                <i style={{ width: `${share ? Math.max(3, share * 100) : 0}%` }}>
                  <img src={modelMarble(model.id)} alt="" />
                </i>
              </div>
              <div className="apm-week-stats">
                <div>
                  <strong>{compact(usage.requestCount)}</strong>
                  <small>次调用{share ? ` · 占 ${Math.round(share * 100)}%` : ''}</small>
                </div>
                <div>
                  <strong>{compact(usage.inputTokens)}</strong>
                  <small>输入 token</small>
                </div>
                <div>
                  <strong>{compact(usage.outputTokens)}</strong>
                  <small>输出 token</small>
                </div>
                <div>
                  <strong>{usd(usage.estimatedCostUsd)}</strong>
                  <small>估算费用</small>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </PhonePage>
  );
}
