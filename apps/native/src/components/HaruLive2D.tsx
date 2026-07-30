import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type PixiModule = typeof import('pixi.js');
type Live2DModule = typeof import('pixi-live2d-display/cubism4');
type Live2DModelInstance = InstanceType<Live2DModule['Live2DModel']>;

type Live2DRuntime = {
  app: import('pixi.js').Application;
  model: Live2DModelInstance;
  resizeObserver: ResizeObserver | null;
  removeRuntimeListeners?: () => void;
};

declare global {
  interface Window {
    PIXI?: PixiModule;
    Live2DCubismCore?: unknown;
    __syntaraNativeCubismCorePromise?: Promise<void>;
  }
}

const CORE_SRC = `${import.meta.env.BASE_URL}live2d/live2dcubismcore.min.js`;
const HARU_MODEL_SRC = `${import.meta.env.BASE_URL}live2d/Haru/Haru.model3.json`;

export function HaruLive2D({ fallbackSrc }: { fallbackSrc: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Live2DRuntime | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const mount = mountRef.current;

    const setup = async () => {
      if (!mount) return;

      let app: import('pixi.js').Application | null = null;
      let model: Live2DModelInstance | null = null;

      try {
        setStatus('loading');
        await ensureCubismCore();

        const PIXI = await import('pixi.js');
        await import('@pixi/unsafe-eval');
        window.PIXI = PIXI;

        const live2dModule = (await import('pixi-live2d-display/cubism4')) as Live2DModule & {
          config?: { sound?: boolean };
        };
        if (live2dModule.config) {
          live2dModule.config.sound = false;
        }

        if (cancelled) return;

        app = new PIXI.Application({
          antialias: true,
          autoDensity: true,
          autoStart: true,
          backgroundAlpha: 0,
          powerPreference: 'high-performance',
          resizeTo: mount,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
        });

        const canvas = app.view as HTMLCanvasElement;
        mount.replaceChildren(canvas);

        model = (await live2dModule.Live2DModel.from(HARU_MODEL_SRC, {
          autoFocus: false,
          autoHitTest: false,
          idleMotionGroup: 'Idle',
          ticker: app.ticker,
        })) as Live2DModelInstance;

        if (cancelled) {
          destroyRuntime({ app, model, resizeObserver: null });
          return;
        }

        app.stage.addChild(model);
        model.eventMode = 'none';

        const originalSize = {
          width: Math.max(model.width, 1),
          height: Math.max(model.height, 1),
        };

        const fitModel = () => {
          if (!app || !model) return;
          const width = mount.clientWidth;
          const height = mount.clientHeight;
          if (!width || !height) return;

          app.renderer.resize(width, height);
          model.anchor.set(0.5, 0.5);
          model.scale.set(
            Math.min((width * 0.94) / originalSize.width, (height * 0.98) / originalSize.height),
          );
          model.position.set(width * 0.52, height * 0.54);
          model.focus(width * 0.5, height * 0.36, true);
        };

        fitModel();
        const resizeObserver =
          typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fitModel);
        resizeObserver?.observe(mount);

        const handleVisibilityChange = () => {
          if (!app) return;
          if (document.hidden) {
            app.stop();
          } else {
            app.start();
          }
        };
        const handleContextLost = (event: Event) => {
          event.preventDefault();
          app?.stop();
          setStatus('error');
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        canvas.addEventListener('webglcontextlost', handleContextLost);

        runtimeRef.current = {
          app,
          model,
          resizeObserver,
          removeRuntimeListeners: () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            canvas.removeEventListener('webglcontextlost', handleContextLost);
          },
        };
        requestAnimationFrame(fitModel);
        void model.motion('Idle');
        setStatus('ready');
      } catch (error) {
        if (app) {
          destroyRuntime({ app, model, resizeObserver: null });
        }
        if (!cancelled) {
          console.error('Haru Live2D failed to initialize', error);
          setStatus('error');
        }
      }
    };

    void setup();

    return () => {
      cancelled = true;
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      if (runtime) {
        destroyRuntime(runtime);
      }
      mount?.replaceChildren();
    };
  }, []);

  const focusModel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const model = runtimeRef.current?.model;
    if (!model) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    model.focus(event.clientX - bounds.left, event.clientY - bounds.top);
  };

  const resetFocus = () => {
    const model = runtimeRef.current?.model;
    const mount = mountRef.current;
    if (!model || !mount) return;
    model.focus(mount.clientWidth * 0.5, mount.clientHeight * 0.4);
  };

  const playTapMotion = () => {
    const model = runtimeRef.current?.model;
    if (!model) return;
    void model.motion('TapBody', undefined, 3);
    void model.expression();
  };

  return (
    <div
      className={`native-haru-live2d is-${status}`}
      onClick={playTapMotion}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          playTapMotion();
        }
      }}
      onPointerLeave={resetFocus}
      onPointerMove={focusModel}
      role="button"
      tabIndex={0}
      aria-label="Haru Live2D 学习伙伴，点击和她互动"
    >
      <div ref={mountRef} className="native-haru-live2d-canvas" aria-hidden />
      {status !== 'ready' ? (
        <img className="native-haru-live2d-fallback" src={fallbackSrc} alt="" aria-hidden />
      ) : null}
      <span className="native-haru-live2d-status" aria-live="polite">
        {status === 'loading' ? '正在唤醒 Haru…' : status === 'error' ? 'Haru 暂时未能加载' : ''}
      </span>
    </div>
  );
}

function ensureCubismCore() {
  if (window.Live2DCubismCore) {
    return Promise.resolve();
  }
  if (window.__syntaraNativeCubismCorePromise) {
    return window.__syntaraNativeCubismCorePromise;
  }

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-syntara-cubism-core]');
    const script = existing ?? document.createElement('script');

    const handleLoad = () => {
      if (window.Live2DCubismCore) {
        resolve();
      } else {
        script.remove();
        reject(new Error('Cubism Core loaded without exposing its runtime'));
      }
    };
    const handleError = () => {
      script.remove();
      reject(new Error(`Unable to load Cubism Core from ${CORE_SRC}`));
    };

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });

    if (!existing) {
      script.src = CORE_SRC;
      script.async = true;
      script.dataset.syntaraCubismCore = 'true';
      document.head.appendChild(script);
    }
  }).catch((error) => {
    window.__syntaraNativeCubismCorePromise = undefined;
    throw error;
  });

  window.__syntaraNativeCubismCorePromise = promise;
  return promise;
}

function destroyRuntime(
  runtime: Omit<Live2DRuntime, 'model'> & { model: Live2DModelInstance | null },
) {
  try {
    runtime.resizeObserver?.disconnect();
  } catch {
    // ResizeObserver cleanup is best effort.
  }
  runtime.removeRuntimeListeners?.();

  try {
    runtime.app.stop();
  } catch {
    // The ticker may already be stopped during a React strict-mode remount.
  }

  if (runtime.model) {
    try {
      runtime.model.parent?.removeChild(runtime.model);
    } catch {
      // The model may already be detached.
    }
    try {
      runtime.model.destroy({ children: true });
    } catch {
      // Cubism may have already released the model.
    }
  }

  try {
    runtime.app.stage?.removeChildren();
    runtime.app.destroy(true, { children: false });
  } catch {
    // Pixi cleanup is intentionally idempotent.
  }
}
