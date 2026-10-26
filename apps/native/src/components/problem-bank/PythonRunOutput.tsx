export type PythonDebugResult = {
  phase: 'idle' | 'loading' | 'running' | 'success' | 'error' | 'stopped';
  output: string;
  error: string;
};

export function PythonRunOutput({ result, stale }: { result: PythonDebugResult; stale?: boolean }) {
  const labels: Record<PythonDebugResult['phase'], string> = {
    idle: '点击「运行」查看输出',
    loading: '正在准备 Python…',
    running: '正在运行…',
    success: '运行完成',
    error: '运行出错',
    stopped: '运行已停止',
  };
  return (
    <section className="pp-run-output" aria-label="运行结果">
      {stale ? <p className="pp-run-status">代码已修改，点击运行更新结果。</p> : null}
      <p className={`pp-run-status is-${result.phase}`} role="status">
        {labels[result.phase]}
      </p>
      {result.output ? (
        <pre className="pp-run-console" aria-label="程序输出">
          {result.output}
        </pre>
      ) : null}
      {result.error ? (
        <pre className="pp-run-console is-error" aria-label="运行错误">
          {result.error}
        </pre>
      ) : null}
      {result.phase === 'success' && !result.output ? (
        <p className="pp-run-empty">程序没有输出。使用 print() 查看变量或结果。</p>
      ) : null}
    </section>
  );
}
