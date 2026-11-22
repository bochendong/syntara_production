import { useId, useState, type ChangeEvent } from 'react';
import { ArrowRight, Network } from 'lucide-react';
import {
  readProblemMemoryDiagram,
  type MemoryDiagramCell,
  type ProblemMemoryDiagram,
} from '../../../../../lib/problem-bank/memory-diagram';
import type { ProblemContentLanguage } from '../../lib/problem-language';
import './problem-memory-diagram.css';

const pythonTypes: readonly string[] = [
  'int',
  'float',
  'bool',
  'str',
  'list',
  'tuple',
  'dict',
  'set',
  'range',
  'NoneType',
];

type DiagramAnswer = {
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
  disabled: boolean;
};

type DiagramHover =
  | { kind: 'reference'; cell: MemoryDiagramCell }
  | { kind: 'elements'; objectIndex: number };

function normalizeObjectId(value: string) {
  const id = value.trim().toLowerCase();
  const digits = /^(?:id\s*)?(\d+)$/.exec(id);
  return digits ? `id${digits[1]}` : id;
}

export function ProblemMemoryModel({
  diagram,
  locale,
  answer,
  referenceValues,
}: {
  diagram: ProblemMemoryDiagram;
  locale: ProblemContentLanguage;
  answer?: DiagramAnswer;
  referenceValues?: Record<string, string>;
}) {
  const heading = useId();
  const [hover, setHover] = useState<DiagramHover | null>(null);
  const chinese = locale === 'zh-CN';
  const cellText = (cell: MemoryDiagramCell) =>
    typeof cell === 'string'
      ? cell
      : (referenceValues?.[cell.blankId] ?? answer?.values[cell.blankId] ?? '');
  const referencedObjectId =
    hover?.kind === 'reference' ? normalizeObjectId(cellText(hover.cell)) : '';
  const listsWithHighlightedElements = new Set<number>();
  const elementObjectIds = new Set<string>();
  diagram.objects.forEach(({ id, value }, index) => {
    if (!Array.isArray(value)) return;
    const headerHovered = hover?.kind === 'elements' && hover.objectIndex === index;
    const listReferenced =
      referencedObjectId !== '' && normalizeObjectId(cellText(id)) === referencedObjectId;
    if (!headerHovered && !listReferenced) return;
    listsWithHighlightedElements.add(index);
    for (const element of value) {
      const elementId = normalizeObjectId(cellText(element));
      if (elementId) elementObjectIds.add(elementId);
    }
  });
  const cell = (
    value: MemoryDiagramCell,
    label: string,
    kind: 'text' | 'number' | 'type' | 'reference' = 'text',
  ) => {
    const current = cellText(value);
    const referenceEvents =
      kind === 'reference'
        ? {
            'data-memory-reference': '',
            onPointerEnter: () => setHover({ kind: 'reference', cell: value }),
            onPointerLeave: () => setHover(null),
          }
        : undefined;
    if (typeof value === 'string' || referenceValues) {
      return (
        <code className="memory-model-value" {...referenceEvents}>
          {current}
        </code>
      );
    }
    const field = {
      className: 'memory-model-blank',
      'aria-label': label,
      'data-blank-id': value.blankId,
      'data-filled': current ? '' : undefined,
      disabled: !answer || answer.disabled,
      value: current,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        answer?.onChange(value.blankId, event.currentTarget.value),
    };
    if (kind === 'type') {
      return (
        <select {...field}>
          <option value="">{chinese ? '选择' : 'Select'}</option>
          {current && !pythonTypes.includes(current) ? (
            <option value={current}>{current}</option>
          ) : null}
          {pythonTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        {...field}
        {...referenceEvents}
        type="text"
        inputMode={kind === 'number' ? 'numeric' : 'text'}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
      />
    );
  };
  const listCountLabel = chinese ? '不同列表的数量' : 'Distinct lists';
  const objectCards = diagram.objects.map(({ id, pythonType, value }, index) => {
    const name =
      typeof id === 'string' ? id : chinese ? `对象 ${index + 1}` : `Object ${index + 1}`;
    const field = (zh: string, en: string) => `${name} · ${chinese ? zh : en}`;
    const scalar = !Array.isArray(value);
    const objectId = normalizeObjectId(cellText(id));
    const directlyReferenced = referencedObjectId !== '' && objectId === referencedObjectId;
    const highlightClass = directlyReferenced
      ? ' is-reference-target'
      : elementObjectIds.has(objectId)
        ? ' is-element-target'
        : '';
    const elementsHighlighted = listsWithHighlightedElements.has(index);
    return {
      known:
        scalar &&
        typeof id === 'string' &&
        typeof pythonType === 'string' &&
        typeof value === 'string',
      element: (
        <div
          className={`memory-model-object${highlightClass}`}
          key={typeof id === 'string' ? id : id.blankId}
          role="group"
          aria-label={name}
          onPointerOver={
            scalar
              ? undefined
              : (event) => {
                  if (
                    event.target instanceof Element &&
                    event.target.closest('[data-memory-reference]')
                  ) {
                    return;
                  }
                  setHover({ kind: 'elements', objectIndex: index });
                }
          }
          onPointerLeave={scalar ? undefined : () => setHover(null)}
        >
          <div className="memory-model-object-header">
            <div className="memory-model-object-id">
              <span>{chinese ? '对象 ID' : 'Object ID'}</span>
              {cell(id, field('ID', 'ID'))}
            </div>
            <div className="memory-model-object-type">
              <span>{chinese ? '类型' : 'Type'}</span>
              {cell(pythonType, field('类型', 'type'), 'type')}
            </div>
          </div>
          {Array.isArray(value) ? (
            <div
              className={
                elementsHighlighted
                  ? 'memory-model-elements are-highlighted'
                  : 'memory-model-elements'
              }
            >
              {value.map((item, i) => (
                <div key={i}>
                  <span>{i}</span>
                  {cell(item, field(`下标 ${i}`, `index ${i}`), 'reference')}
                </div>
              ))}
              {value.length === 0 && <code className="memory-model-value">[]</code>}
            </div>
          ) : (
            <div className="memory-model-scalar">{cell(value, field('值', 'value'))}</div>
          )}
        </div>
      ),
    };
  });
  const known = objectCards.filter((object) => object.known);
  const objects = objectCards.filter((object) => !object.known);

  return (
    <section className="memory-model" aria-labelledby={heading}>
      <div className="memory-model-heading">
        <div className="memory-model-title">
          <span className="memory-model-icon">
            <Network aria-hidden="true" size={19} />
          </span>
          <h3 id={heading}>{chinese ? '内存模型' : 'Memory model'}</h3>
        </div>
        <ul className="memory-model-legend" aria-label={chinese ? '高亮图例' : 'Highlight legend'}>
          <li>{chinese ? '直接引用' : 'Direct reference'}</li>
          <li>{chinese ? '列表元素' : 'List elements'}</li>
        </ul>
      </div>
      <div className="memory-model-workspace">
        {(diagram.variables.length > 0 || diagram.listCount !== undefined) && (
          <div className="memory-model-stack">
            {diagram.variables.length > 0 && (
              <>
                <h4>{chinese ? '变量' : 'Variables'}</h4>
                <div className="memory-model-bindings">
                  {diagram.variables.map(({ name, reference }) => (
                    <div className="memory-model-binding" key={name}>
                      <code>{name}</code>
                      <ArrowRight aria-hidden="true" size={13} />
                      {cell(
                        reference,
                        chinese ? `变量 ${name} 引用` : `variable ${name} reference`,
                        'reference',
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            {diagram.listCount !== undefined && (
              <div className="memory-model-count">
                <span>{listCountLabel}</span>
                {cell(diagram.listCount, listCountLabel, 'number')}
              </div>
            )}
          </div>
        )}
        <div className="memory-model-heap">
          {objects.length > 0 && (
            <div className="memory-model-objects">
              <h4>{chinese ? '对象' : 'Objects'}</h4>
              {objects.map(({ element }) => element)}
            </div>
          )}
          {known.length > 0 && (
            <div className="memory-model-givens">
              <h4>{chinese ? '已知对象' : 'Given objects'}</h4>
              <div className="memory-model-given-grid">{known.map(({ element }) => element)}</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function ProblemMemoryIllustration({
  content,
  locale,
  showEditable = false,
}: {
  content: Record<string, unknown>;
  locale: ProblemContentLanguage;
  showEditable?: boolean;
}) {
  const model = readProblemMemoryDiagram(content);
  return model && (!model.editable || showEditable) ? (
    <div className="problem-memory-illustration">
      <ProblemMemoryModel diagram={model.diagram} locale={locale} />
    </div>
  ) : null;
}
