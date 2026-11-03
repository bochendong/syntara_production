import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { ChevronDown, Gauge, RefreshCw, Search } from 'lucide-react';

import { nativeAccountAvatarUrl, resolveNativeCourseAvatar } from '../assets';
import {
  getAdminOverview,
  getAdminUserCourses,
  saveAdminLlm,
  searchAdminUsers,
  setAdminGlobalLimit,
  setAdminUserLimit,
  setAdminUserRole,
  type AdminLlmConfig,
  type AdminOverview,
  type AdminRole,
  type AdminUser,
  type AdminUserCourse,
  type AdminUsersPage,
} from '../data/platform-api-client';
import { marbleImages } from '../lib/learning-action-marbles';
import { GlassSkeletonRows } from './GlassLoadMore';
import { PhoneConfirm, PhoneEmpty, PhonePage } from './PhonePages';
import './admin-page.css';
import { AdminCoursesTab } from './AdminCoursesTab';

/**
 * 「管理」页：测试服管理员控制台，只有管理员账号能看到入口。
 * 四块：全站模型、API Key、账号身份（含单个账号的额度）、全站用量额度。
 * 和网页 /admin 管理中心读写同一份服务端配置。
 */

type Tab = 'models' | 'keys' | 'users' | 'courses' | 'usage';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'models', label: '模型' },
  { id: 'keys', label: 'Key' },
  { id: 'users', label: '账号' },
  { id: 'courses', label: '课程' },
  { id: 'usage', label: '用量' },
];

const ROLES: Array<{ id: AdminRole; label: string; marble: string }> = [
  { id: 'STUDENT', label: '学生', marble: marbleImages.green },
  { id: 'TEACHER', label: '老师', marble: marbleImages.blue },
  { id: 'ADMIN', label: '管理员', marble: marbleImages.pink },
  { id: 'USER', label: '用户', marble: marbleImages.purple },
];

const ROLE_LABEL = Object.fromEntries(ROLES.map((role) => [role.id, role.label])) as Record<
  AdminRole,
  string
>;

const TIERS: Array<{ id: keyof AdminLlmConfig['tierModels']; label: string; hint: string }> = [
  { id: 'low', label: '低', hint: '日常问答' },
  { id: 'medium', label: '中', hint: '分步讲解' },
  { id: 'high', label: '高', hint: '难题推理' },
];

function money(value: number) {
  return `$${value.toFixed(value >= 100 ? 0 : 2)}`;
}

function errorText(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function parseLimit(value: string, integer: boolean): number | null | 'invalid' {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return 'invalid';
  return integer ? Math.round(parsed) : parsed;
}

function limitText(value: number | null | undefined) {
  return value == null ? '' : String(value);
}

export function AdminPage({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('models');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    try {
      setOverview(await getAdminOverview());
      setError('');
    } catch (cause) {
      setError(errorText(cause, '读取失败'));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const saved = (message: string) => {
    setError('');
    setNotice(message);
  };

  return (
    <PhonePage title="管理" overlay largeTitle onBack={onBack}>
      <div className="ap-page">
        <header className="phone-large-head ap-head">
          <h1>管理</h1>
          <span className="ap-env">测试服</span>
          <button
            type="button"
            className="ap-icon-button"
            aria-label="刷新"
            onClick={() => void reload()}
          >
            <RefreshCw size={16} aria-hidden />
          </button>
        </header>

        <div className="phone-segmented ap-tabs" role="tablist" aria-label="管理分区">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? 'is-active' : undefined}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error ? <p className="phone-page-error">{error}</p> : null}
        {!overview && !error ? <GlassSkeletonRows rows={4} height={54} /> : null}

        {overview && tab === 'models' ? (
          <ModelsTab
            key={overview.llm.updatedAt ?? 'env'}
            overview={overview}
            onSaved={(llm) => {
              setOverview({ ...overview, llm });
              saved('模型已更新');
            }}
            onError={setError}
          />
        ) : null}
        {overview && tab === 'keys' ? (
          <KeysTab
            overview={overview}
            onSaved={(llm) => {
              setOverview({ ...overview, llm });
              saved('Key 已更新');
            }}
            onError={setError}
          />
        ) : null}
        {overview && tab === 'users' ? (
          <UsersTab
            overview={overview}
            onSaved={saved}
            onError={setError}
            onRoleChanged={() => void reload()}
          />
        ) : null}
        {overview && tab === 'courses' ? <AdminCoursesTab /> : null}
        {overview && tab === 'usage' ? (
          <UsageTab
            overview={overview}
            onSaved={(usage) => {
              setOverview({ ...overview, usage });
              saved('全站额度已更新');
            }}
            onError={setError}
          />
        ) : null}

        {notice ? (
          <div className="ap-notice" role="status">
            <img src={marbleImages.green} alt="" />
            {notice}
          </div>
        ) : null}
      </div>
    </PhonePage>
  );
}

function SaveBar({
  dirty,
  busy,
  label = '保存',
  onSave,
  children,
}: {
  dirty: boolean;
  busy: boolean;
  label?: string;
  onSave: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="ap-save-bar">
      {children}
      <button type="button" className="ap-save" disabled={!dirty || busy} onClick={onSave}>
        {busy ? '保存中…' : label}
      </button>
    </div>
  );
}

function ModelSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: AdminOverview['modelOptions'];
  onChange: (value: string) => void;
  label: string;
}) {
  const known = options.some((option) => option.id === value);
  return (
    <span className="ap-select">
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {known ? null : <option value={value}>{value}</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden />
    </span>
  );
}

function ModelsTab({
  overview,
  onSaved,
  onError,
}: {
  overview: AdminOverview;
  onSaved: (llm: AdminLlmConfig) => void;
  onError: (message: string) => void;
}) {
  const { llm, modelOptions } = overview;
  const [modelId, setModelId] = useState(llm.modelId);
  const [tiers, setTiers] = useState(llm.tierModels);
  const [busy, setBusy] = useState(false);
  const dirty =
    modelId !== llm.modelId || TIERS.some((tier) => tiers[tier.id] !== llm.tierModels[tier.id]);
  const description = (id: string) => modelOptions.find((option) => option.id === id)?.description;
  const unsupported = [modelId, ...Object.values(tiers)].some(
    (id) => !modelOptions.some((option) => option.id === id),
  );

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await saveAdminLlm({ modelId, tierModels: tiers }));
    } catch (cause) {
      onError(errorText(cause, '保存失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="phone-group-title">全站默认模型</p>
      <div className="phone-group">
        <div className="phone-row">
          <img className="ap-row-marble" src={marbleImages.purple} alt="" />
          <span className="phone-row-copy">
            <strong>默认模型</strong>
            <small>{description(modelId) ?? '生成笔记、出题、后台任务'}</small>
          </span>
          <ModelSelect
            value={modelId}
            options={modelOptions}
            onChange={setModelId}
            label="默认模型"
          />
        </div>
      </div>

      <p className="phone-group-title">聊天回复强度</p>
      <div className="phone-group">
        {TIERS.map((tier) => (
          <div key={tier.id} className="phone-row">
            <span className={`ap-tier ap-tier-${tier.id}`}>{tier.label}</span>
            <span className="phone-row-copy">
              <strong>{tier.hint}</strong>
              <small>{description(tiers[tier.id])}</small>
            </span>
            <ModelSelect
              value={tiers[tier.id]}
              options={modelOptions}
              label={`回复强度 ${tier.label}`}
              onChange={(value) => setTiers((current) => ({ ...current, [tier.id]: value }))}
            />
          </div>
        ))}
      </div>
      <p className="phone-group-footer">
        {llm.source === 'database' ? '来自管理员设置' : '还在用环境变量的默认值'}
        {llm.updatedAt ? ` · ${new Date(llm.updatedAt).toLocaleString('zh-CN')}` : ''}
      </p>

      <SaveBar dirty={dirty && !unsupported} busy={busy} onSave={() => void save()}>
        {unsupported ? (
          <span className="ap-save-hint">有模型不在可选列表里，请先换一个</span>
        ) : null}
      </SaveBar>
    </>
  );
}

function KeysTab({
  overview,
  onSaved,
  onError,
}: {
  overview: AdminOverview;
  onSaved: (llm: AdminLlmConfig) => void;
  onError: (message: string) => void;
}) {
  const { llm, providers } = overview;
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(llm.baseUrl);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const dirty = Boolean(apiKey.trim()) || baseUrl.trim() !== llm.baseUrl;

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!dirty) return;
    setBusy(true);
    try {
      onSaved(
        await saveAdminLlm({
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        }),
      );
      setApiKey('');
    } catch (cause) {
      onError(errorText(cause, '保存失败'));
    } finally {
      setBusy(false);
    }
  };

  const configured = providers.filter((provider) => provider.configured);
  const missing = providers.filter((provider) => !provider.configured);
  const kindLabel = { image: '图像', tts: '语音', webSearch: '搜索' } as const;

  return (
    <form onSubmit={(event) => void save(event)}>
      <p className="phone-group-title">OpenAI · 聊天和生成都走这把 Key</p>
      <div className="phone-group">
        <div className="phone-row">
          <img
            className="ap-row-marble"
            src={llm.hasApiKey ? marbleImages.green : marbleImages.pink}
            alt=""
          />
          <span className="phone-row-copy">
            <strong className="ap-mono">{llm.hasApiKey ? llm.maskedApiKey : '还没有 Key'}</strong>
            <small>{llm.source === 'database' ? '管理员设置' : '环境变量 OPENAI_API_KEY'}</small>
          </span>
        </div>
        <label className="phone-row phone-field ap-field">
          <span>新 Key</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="留空就不换"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <label className="phone-row phone-field ap-field">
          <span>服务地址</span>
          <input
            type="url"
            spellCheck={false}
            placeholder="https://api.openai.com/v1"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
      </div>
      <SaveBar dirty={dirty} busy={busy} label="保存 Key" onSave={() => void save()} />

      <p className="phone-group-title">其他服务 · 在 Railway 环境变量里改</p>
      <div className="phone-group">
        {[...configured, ...(showAll ? missing : [])].map((provider) => (
          <div key={`${provider.kind}:${provider.id}`} className="phone-row">
            <img
              className="ap-row-marble is-small"
              src={provider.configured ? marbleImages.green : marbleImages.purple}
              alt=""
              data-off={!provider.configured || undefined}
            />
            <span className="phone-row-copy">
              <strong>{provider.name}</strong>
              <small>
                {kindLabel[provider.kind]}
                {provider.envName ? ` · ${provider.envName}` : ''}
              </small>
            </span>
            <span className="phone-row-value ap-mono">
              {provider.configured
                ? provider.keyLast4
                  ? `••••${provider.keyLast4}`
                  : '已配置'
                : '没配置'}
            </span>
          </div>
        ))}
        {missing.length ? (
          <button
            type="button"
            className="phone-row phone-row-button phone-row-center ap-more"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? '收起' : `还有 ${missing.length} 个没配置`}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function UsersTab({
  overview,
  onSaved,
  onError,
  onRoleChanged,
}: {
  overview: AdminOverview;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
  onRoleChanged: () => void;
}) {
  const [filters, setFilters] = useState<{ query: string; role: AdminRole | null; page: number }>({
    query: '',
    role: null,
    page: 1,
  });
  const { query, role, page } = filters;
  const [loaded, setLoaded] = useState<{
    filters: typeof filters;
    data: AdminUsersPage | null;
  } | null>(null);
  const result = loaded?.filters === filters ? loaded.data : null;
  const loading = loaded?.filters !== filters;
  const users = result?.users;
  const [openId, setOpenId] = useState<string | null>(null);
  const searchRef = useRef<HTMLLabelElement>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        searchAdminUsers(query, role, page)
          .then((data) => {
            if (!cancelled) setLoaded({ filters, data });
          })
          .catch((cause) => {
            if (!cancelled) {
              setLoaded({ filters, data: null });
              onError(errorText(cause, '读取账号失败'));
            }
          });
      },
      query ? 300 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onError, filters, query, role, page]);

  const replace = (user: AdminUser) =>
    setLoaded((current) =>
      current?.data
        ? {
            ...current,
            data: {
              ...current.data,
              users: current.data.users.map((row) => (row.id === user.id ? user : row)),
            },
          }
        : current,
    );

  const changePage = (nextPage: number) => {
    setOpenId(null);
    setFilters({ ...filters, page: nextPage });
    searchRef.current?.scrollIntoView({ block: 'start' });
  };

  return (
    <>
      <div className="ap-role-chips" role="radiogroup" aria-label="按身份筛选">
        <button
          type="button"
          aria-pressed={role === null}
          onClick={() => {
            setOpenId(null);
            setFilters({ ...filters, role: null, page: 1 });
          }}
        >
          全部
        </button>
        {ROLES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={role === item.id}
            onClick={() => {
              setOpenId(null);
              setFilters({ ...filters, role: role === item.id ? null : item.id, page: 1 });
            }}
          >
            <img src={item.marble} alt="" />
            {item.label}
            <small>{overview.roleCounts[item.id] ?? 0}</small>
          </button>
        ))}
      </div>

      <label className="phone-search ap-search" ref={searchRef}>
        <Search size={16} aria-hidden />
        <input
          type="search"
          placeholder="搜邮箱或名字"
          value={query}
          onChange={(event) => {
            setOpenId(null);
            setFilters({ ...filters, query: event.target.value, page: 1 });
          }}
        />
      </label>

      {loading ? <GlassSkeletonRows rows={5} height={58} /> : null}
      {!loading && !result ? (
        <button type="button" className="phone-row" onClick={() => setFilters({ ...filters })}>
          重新加载账号
        </button>
      ) : null}
      {users && !users.length ? (
        <PhoneEmpty title="没找到账号" hint="换个邮箱或名字试试。" />
      ) : null}
      {users?.length ? (
        <div className="phone-group">
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              me={user.id === overview.me.userId}
              open={openId === user.id}
              onToggle={() => setOpenId(openId === user.id ? null : user.id)}
              onChanged={(next, message, roleChanged) => {
                replace(next);
                onSaved(message);
                if (roleChanged) {
                  setOpenId(null);
                  setFilters({ ...filters, page: result?.page ?? page });
                  onRoleChanged();
                }
              }}
              onError={onError}
            />
          ))}
        </div>
      ) : null}
      {result ? (
        <nav className="ap-pagination" aria-label="账号分页">
          <span role="status" aria-live="polite">
            共 {result.total} 个 · 第 {result.page} /{' '}
            {Math.max(1, Math.ceil(result.total / result.pageSize))} 页
          </span>
          <div>
            <button
              type="button"
              disabled={result.page <= 1}
              onClick={() => changePage(result.page - 1)}
            >
              上一页
            </button>
            <button
              type="button"
              disabled={result.page * result.pageSize >= result.total}
              onClick={() => changePage(result.page + 1)}
            >
              下一页
            </button>
          </div>
        </nav>
      ) : null}
    </>
  );
}

function UsageMeter({ used, limit, label }: { used: number; limit: number | null; label: string }) {
  const ratio = limit ? Math.min(1, used / limit) : 0;
  const tone = !limit ? 'none' : ratio >= 1 ? 'full' : ratio >= 0.8 ? 'high' : 'ok';
  return (
    <span className={`ap-meter is-${tone}`} aria-label={label}>
      <span style={{ width: `${Math.max(limit ? 4 : 0, ratio * 100)}%` }} />
    </span>
  );
}

function UserCourses({ userId }: { userId: string }) {
  const [courses, setCourses] = useState<AdminUserCourse[] | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getAdminUserCourses(userId)
      .then((rows) => {
        if (!cancelled) setCourses(rows);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorText(cause, '暂时无法读取课程。'));
      });
    return () => {
      cancelled = true;
    };
  }, [userId, revision]);

  return (
    <section className="ap-account-section ap-account-courses" aria-label="账号课程">
      <div className="ap-section-heading">
        <h3>已加入课程</h3>
        {courses ? <span className="ap-course-count">{courses.length} 门</span> : null}
      </div>
      <p className="ap-panel-hint">该账号可访问的课程，包含自行创建的课程。</p>
      {error ? (
        <div className="ap-course-empty" role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setError('');
              setCourses(null);
              setRevision((value) => value + 1);
            }}
          >
            重新加载
          </button>
        </div>
      ) : !courses ? (
        <GlassSkeletonRows rows={3} height={54} />
      ) : courses.length ? (
        <ul className="ap-course-list">
          {courses.map((course) => (
            <li key={course.id}>
              <img
                src={resolveNativeCourseAvatar(course.id, course.courseCode, course.avatarUrl)}
                alt=""
              />
              <span className="ap-course-copy">
                <strong>{course.courseCode || course.name}</strong>
                <small>
                  {[
                    course.courseCode && course.name !== course.courseCode ? course.name : null,
                    course.university,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '课程'}
                </small>
              </span>
              <span className="ap-course-access">
                {course.accessRole === 'owner' ? '自建 / 管理' : '已加入'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ap-course-empty">
          <strong>还没有课程</strong>
          <p>该账号尚未加入或创建课程。</p>
        </div>
      )}
    </section>
  );
}

function UserRow({
  user,
  me,
  open,
  onToggle,
  onChanged,
  onError,
}: {
  user: AdminUser;
  me: boolean;
  open: boolean;
  onToggle: () => void;
  onChanged: (user: AdminUser, message: string, roleChanged: boolean) => void;
  onError: (message: string) => void;
}) {
  const [cost, setCost] = useState(limitText(user.limit?.weeklyCostLimitUsd));
  const [requests, setRequests] = useState(limitText(user.limit?.weeklyRequestLimit));
  const [disabled, setDisabled] = useState(Boolean(user.limit?.disabled));
  const [busy, setBusy] = useState(false);
  const [pendingRole, setPendingRole] = useState<AdminRole | null>(null);

  const limitDirty =
    cost !== limitText(user.limit?.weeklyCostLimitUsd) ||
    requests !== limitText(user.limit?.weeklyRequestLimit) ||
    disabled !== Boolean(user.limit?.disabled);
  const costLimit = user.limit?.weeklyCostLimitUsd ?? null;

  const changeRole = async (role: AdminRole) => {
    setPendingRole(null);
    setBusy(true);
    try {
      onChanged(await setAdminUserRole(user.id, role), `已改成${ROLE_LABEL[role]}`, true);
    } catch (cause) {
      onError(errorText(cause, '修改身份失败'));
    } finally {
      setBusy(false);
    }
  };

  const pickRole = (role: AdminRole) => {
    if (role === user.role) return;
    // 给或收管理员权限要再确认一次。
    if (role === 'ADMIN' || user.role === 'ADMIN') setPendingRole(role);
    else void changeRole(role);
  };

  const saveLimit = async () => {
    const weeklyCostLimitUsd = parseLimit(cost, false);
    const weeklyRequestLimit = parseLimit(requests, true);
    if (weeklyCostLimitUsd === 'invalid' || weeklyRequestLimit === 'invalid') {
      onError('额度要填不小于 0 的数字，留空表示不单独限制。');
      return;
    }
    setBusy(true);
    try {
      const next = await setAdminUserLimit({
        userId: user.id,
        weeklyCostLimitUsd,
        weeklyRequestLimit,
        disabled,
      });
      setCost(limitText(next.limit?.weeklyCostLimitUsd));
      setRequests(limitText(next.limit?.weeklyRequestLimit));
      setDisabled(Boolean(next.limit?.disabled));
      onChanged(next, '额度已更新', false);
    } catch (cause) {
      onError(errorText(cause, '保存额度失败'));
    } finally {
      setBusy(false);
    }
  };

  const roleMarble = ROLES.find((item) => item.id === user.role)?.marble;

  return (
    <div className={`ap-user${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="phone-row phone-row-button ap-user-row"
        aria-expanded={open}
        onClick={onToggle}
      >
        <img className="ap-avatar" src={nativeAccountAvatarUrl(null, user.image)} alt="" />
        <span className="phone-row-copy">
          <strong>
            {user.name || user.email || user.id}
            {me ? <em className="ap-me">我</em> : null}
            {!user.isActive ? <em className="ap-off">停用</em> : null}
          </strong>
          <small>
            {user.email && user.name ? `${user.email} · ` : ''}本周{' '}
            {money(user.usage.estimatedCostUsd)}
            {costLimit != null ? ` / ${money(costLimit)}` : ''} · {user.usage.requestCount} 次
            {user.limit?.disabled ? ' · 已暂停 AI' : ''}
          </small>
        </span>
        <span className="ap-role-pill" data-role={user.role}>
          {roleMarble ? <img src={roleMarble} alt="" /> : null}
          {ROLE_LABEL[user.role]}
        </span>
        <ChevronDown size={16} className="ap-user-chevron" aria-hidden />
      </button>

      {open ? (
        <div className="ap-user-panel">
          <section className="ap-account-identity" aria-label="账号身份">
            <div>
              <h3>账号身份</h3>
              <p className="ap-panel-hint">
                {me ? '当前账号，保留管理员身份。' : '决定该账号可以使用的功能。'}
              </p>
            </div>
            <div className="phone-segmented ap-role-segment" role="radiogroup" aria-label="身份">
              {ROLES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={user.role === item.id}
                  className={user.role === item.id ? 'is-active' : undefined}
                  disabled={busy || (me && item.id !== 'ADMIN')}
                  onClick={() => pickRole(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <UserCourses userId={user.id} />

          <section className="ap-account-section ap-account-quota" aria-label="账号用量与额度">
            <div className="ap-section-heading">
              <h3>用量与额度</h3>
              <span className="ap-section-caption">本周</span>
            </div>
            <div className="ap-user-usage">
              <div>
                <span>已用成本</span>
                <strong>{money(user.usage.estimatedCostUsd)}</strong>
              </div>
              <div>
                <span>已用请求</span>
                <strong>
                  {user.usage.requestCount}
                  <small> 次</small>
                </strong>
              </div>
            </div>
            <div className="ap-limit-grid">
              <UsageMeter
                used={user.usage.estimatedCostUsd}
                limit={costLimit}
                label="本周成本用量"
              />
              <label className="ap-limit-field">
                <span>每周成本上限 $</span>
                <input
                  inputMode="decimal"
                  placeholder="不限"
                  value={cost}
                  onChange={(event) => setCost(event.target.value)}
                />
              </label>
              <label className="ap-limit-field">
                <span>每周请求上限</span>
                <input
                  inputMode="numeric"
                  placeholder="不限"
                  value={requests}
                  onChange={(event) => setRequests(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="ap-switch"
                role="switch"
                aria-checked={disabled}
                disabled={busy}
                onClick={() => setDisabled((value) => !value)}
              >
                暂停 AI 使用
                <span className="ap-switch-track" aria-hidden />
              </button>
            </div>
            <p className="ap-panel-hint">留空时只受全站额度限制。</p>
            <SaveBar
              dirty={limitDirty}
              busy={busy}
              label="保存额度"
              onSave={() => void saveLimit()}
            />
          </section>
        </div>
      ) : null}

      {pendingRole ? (
        <PhoneConfirm
          title={pendingRole === 'ADMIN' ? '设为管理员？' : '取消管理员身份？'}
          message={
            pendingRole === 'ADMIN'
              ? `${user.name || user.email} 将能改全站模型、Key、账号和额度。`
              : `${user.name || user.email} 将不能再打开管理页。`
          }
          confirmLabel={pendingRole === 'ADMIN' ? '设为管理员' : `改成${ROLE_LABEL[pendingRole]}`}
          destructive={pendingRole !== 'ADMIN'}
          onConfirm={() => void changeRole(pendingRole)}
          onCancel={() => setPendingRole(null)}
        />
      ) : null}
    </div>
  );
}

function UsageTab({
  overview,
  onSaved,
  onError,
}: {
  overview: AdminOverview;
  onSaved: (usage: AdminOverview['usage']) => void;
  onError: (message: string) => void;
}) {
  const { limit, usage } = overview.usage;
  const [enabled, setEnabled] = useState(limit.enabled);
  const [cost, setCost] = useState(limitText(limit.weeklyCostLimitUsd));
  const [requests, setRequests] = useState(limitText(limit.weeklyRequestLimit));
  const [busy, setBusy] = useState(false);
  const dirty =
    enabled !== limit.enabled ||
    cost !== limitText(limit.weeklyCostLimitUsd) ||
    requests !== limitText(limit.weeklyRequestLimit);
  const activeCost = limit.enabled ? limit.weeklyCostLimitUsd : null;
  const activeRequests = limit.enabled ? limit.weeklyRequestLimit : null;

  const resetDay = useMemo(() => {
    const now = new Date();
    const days = (8 - (now.getUTCDay() || 7)) % 7 || 7;
    return days === 1 ? '明天' : `${days} 天后`;
  }, []);

  const save = async () => {
    const weeklyCostLimitUsd = parseLimit(cost, false);
    const weeklyRequestLimit = parseLimit(requests, true);
    if (weeklyCostLimitUsd === 'invalid' || weeklyRequestLimit === 'invalid') {
      onError('额度要填不小于 0 的数字，留空表示不限。');
      return;
    }
    setBusy(true);
    try {
      onSaved(await setAdminGlobalLimit({ enabled, weeklyCostLimitUsd, weeklyRequestLimit }));
    } catch (cause) {
      onError(errorText(cause, '保存失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="ap-usage-hero">
        <div>
          <small>本周全站</small>
          <strong>{money(usage.estimatedCostUsd)}</strong>
          <p>
            {usage.requestCount} 次请求
            {activeCost != null ? ` · 上限 ${money(activeCost)}` : ''}
            {activeRequests != null ? ` / ${activeRequests} 次` : ''}
          </p>
        </div>
        <span className="ap-usage-reset">{resetDay}重置</span>
        <UsageMeter used={usage.estimatedCostUsd} limit={activeCost} label="本周全站成本" />
      </div>

      <p className="phone-group-title">全站每周上限</p>
      <div className="phone-group">
        <button
          type="button"
          className="phone-row ap-switch ap-switch-row"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((value) => !value)}
        >
          <Gauge size={18} className="ap-switch-icon" aria-hidden />
          <span className="phone-row-copy">
            <strong>开启全站上限</strong>
            <small>到了上限，全站 AI 暂停到下周一</small>
          </span>
          <span className="ap-switch-track" aria-hidden />
        </button>
        <label className="phone-row phone-field ap-field">
          <span>成本 $</span>
          <input
            inputMode="decimal"
            placeholder="不限"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
          />
        </label>
        <label className="phone-row phone-field ap-field">
          <span>请求数</span>
          <input
            inputMode="numeric"
            placeholder="不限"
            value={requests}
            onChange={(event) => setRequests(event.target.value)}
          />
        </label>
      </div>
      <p className="phone-group-footer">
        单个账号的额度在「账号」里点开设置。
        {limit.updatedBy ? ` 上次由 ${limit.updatedBy} 修改。` : ''}
      </p>
      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} />
    </>
  );
}
