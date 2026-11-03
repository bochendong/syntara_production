import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  getCoursePublication,
  publishCourseToStore,
  type CoursePublication,
} from '../data/platform-api-client';
import { CourseModal } from './CourseModal';

export function CoursePublishDialog({
  courseId,
  onClose,
  onPublished,
}: {
  courseId: string;
  onClose: () => void;
  onPublished: () => Promise<void> | void;
}) {
  const [data, setData] = useState<CoursePublication | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const defaultPhoneField = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getCoursePublication(courseId)
      .then((value) => {
        if (!cancelled) {
          if (
            !value.listed &&
            value.organization === 'speedup' &&
            !value.admission.fields.some((field) => field.kind === 'phone_last4') &&
            value.admission.fields.length < 8
          ) {
            const id = crypto.randomUUID();
            defaultPhoneField.current = id;
            value = {
              ...value,
              admission: {
                ...value.admission,
                fields: [
                  ...value.admission.fields,
                  { id, kind: 'phone_last4', label: '手机尾号后四位' },
                ],
              },
            };
          }
          setData(value);
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '读取失败');
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, revision]);
  const addField = (kind: 'text' | 'phone_last4') => {
    if (!data) return;
    setData({
      ...data,
      admission: {
        ...data.admission,
        fields: [
          ...data.admission.fields,
          { id: crypto.randomUUID(), kind, label: kind === 'phone_last4' ? '手机尾号后四位' : '' },
        ],
      },
    });
  };
  return (
    <CourseModal
      title={data?.listed ? '商城与加入设置' : '上架到商城'}
      subtitle="让其他同学发现并加入你的课程"
      busy={busy}
      onClose={onClose}
    >
      {!data && !error ? (
        <p className="cp-muted" role="status">
          正在读取课程…
        </p>
      ) : null}
      {!data && error ? (
        <div className="cp-error" role="alert">
          {error}
          <button
            type="button"
            onClick={() => {
              setError('');
              setRevision((value) => value + 1);
            }}
          >
            重试
          </button>
        </div>
      ) : null}
      {data ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !data.canPublish) return;
            setBusy(true);
            setError('');
            try {
              await publishCourseToStore(courseId, {
                name: data.name,
                campus: data.campus,
                organization: data.organization,
                admission: data.admission,
              });
              await onPublished();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : '发布失败');
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy || !data.canPublish} className="cp-form-fields">
            <label className="cp-field">
              课程名称
              <input
                autoFocus
                required
                maxLength={200}
                value={data.name}
                onChange={(event) => setData({ ...data, name: event.target.value })}
              />
            </label>
            <div className="cp-form-columns">
              <label className="cp-field">
                校区
                <input
                  required
                  maxLength={120}
                  placeholder="例如 UBC、UTM"
                  value={data.campus}
                  onChange={(event) => setData({ ...data, campus: event.target.value })}
                />
              </label>
              <label className="cp-field">
                所属组织
                <select
                  value={data.organization}
                  onChange={(event) => {
                    const organization = event.target.value as 'none' | 'speedup';
                    let fields = data.admission.fields;
                    if (
                      organization === 'speedup' &&
                      !fields.some((field) => field.kind === 'phone_last4')
                    ) {
                      if (fields.length >= 8) {
                        setError('申请字段最多为 8 项，请先删除一项再选择 Speedup。');
                        return;
                      }
                      const id = crypto.randomUUID();
                      defaultPhoneField.current = id;
                      fields = [...fields, { id, kind: 'phone_last4', label: '手机尾号后四位' }];
                    } else if (organization === 'none' && defaultPhoneField.current) {
                      fields = fields.filter((field) => field.id !== defaultPhoneField.current);
                      defaultPhoneField.current = null;
                    }
                    setError('');
                    setData({ ...data, organization, admission: { ...data.admission, fields } });
                  }}
                >
                  <option value="none">无组织</option>
                  <option value="speedup" disabled={!data.speedupAvailable}>
                    Speedup
                  </option>
                </select>
              </label>
            </div>
            {data.organization === 'speedup' ? (
              <p className="cp-muted">Speedup 的课程管理者也可以管理课程、处理加入申请。</p>
            ) : null}
            <fieldset className="cp-admission-options">
              <legend>加入条件</legend>
              <label>
                <input
                  type="radio"
                  name="admission"
                  checked={data.admission.mode === 'open'}
                  onChange={() =>
                    setData({ ...data, admission: { ...data.admission, mode: 'open' } })
                  }
                />
                <span>
                  <strong>任何人可以加入</strong>
                  <small>学生点击加入即可进入课程</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="admission"
                  checked={data.admission.mode === 'approval'}
                  onChange={() =>
                    setData({ ...data, admission: { ...data.admission, mode: 'approval' } })
                  }
                />
                <span>
                  <strong>加入需要老师同意</strong>
                  <small>学生填写申请信息，老师同意后才能进入课程</small>
                </span>
              </label>
            </fieldset>
            {data.admission.mode === 'approval' ? (
              <section className="cp-application-fields">
                <h3>申请时必填的信息</h3>
                <p className="cp-muted">学生填写的信息只给课程管理者看，用来决定是否同意加入。</p>
                {data.admission.fields.map((field) => (
                  <div className="cp-field-row" key={field.id}>
                    <label className="cp-field">
                      <input
                        aria-label={
                          field.kind === 'phone_last4' ? '手机尾号字段名称' : '自定义字段名称'
                        }
                        required
                        maxLength={80}
                        value={field.label}
                        placeholder="例如：学生姓名、学号"
                        onChange={(event) =>
                          setData({
                            ...data,
                            admission: {
                              ...data.admission,
                              fields: data.admission.fields.map((item) =>
                                item.id === field.id
                                  ? { ...item, label: event.target.value }
                                  : item,
                              ),
                            },
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="cp-close"
                      aria-label={`删除字段 ${field.label || '自定义字段'}`}
                      onClick={() =>
                        setData({
                          ...data,
                          admission: {
                            ...data.admission,
                            fields: data.admission.fields.filter((item) => item.id !== field.id),
                          },
                        })
                      }
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                ))}
                <div className="cp-add-fields">
                  <button
                    type="button"
                    disabled={data.admission.fields.length >= 8}
                    onClick={() => addField('phone_last4')}
                  >
                    <Plus size={14} aria-hidden />
                    手机尾号后四位
                  </button>
                  <button
                    type="button"
                    disabled={data.admission.fields.length >= 8}
                    onClick={() => addField('text')}
                  >
                    <Plus size={14} aria-hidden />
                    自定义字段
                  </button>
                </div>
              </section>
            ) : null}
          </fieldset>
          <p className="cp-muted cp-publish-note">
            上架后，符合加入条件的学生可以在商城找到并加入课程。课程内容的修改需要另外发布内容更新才生效；开班和加入班级仍单独进行。
          </p>
          {!data.canPublish ? (
            <p className="cp-error">你没有修改此课程发布设置的权限，外部托管课程由原平台维护。</p>
          ) : null}
          {error ? (
            <p className="cp-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="cp-form-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button type="submit" className="cp-primary" disabled={busy || !data.canPublish}>
              {busy ? '正在发布…' : data.listed ? '保存商城设置' : '上架到商城'}
            </button>
          </div>
        </form>
      ) : null}
    </CourseModal>
  );
}
