import { useCallback, useEffect, useRef, useState } from 'react';
import { getModelAvailability, loadModelAvailability } from '../modelAvailability.js';

// The shared request also warms every studio's picker. Keep the mounted gate
// stable across navigation so a slow/failing catalog never discards a draft.
export default function ModelAvailabilityGate({ children, locale = 'en', required = true }) {
  const [state, setState] = useState(() => getModelAvailability() ? 'ready' : 'loading');
  const mounted = useRef(false);
  const retry = useCallback(async () => {
    setState('loading');
    const data = await loadModelAvailability();
    if (mounted.current) setState(data ? 'ready' : 'error');
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (required) {
      if (getModelAvailability()) setState('ready');
      else retry();
    }
    return () => { mounted.current = false; };
  }, [required, retry]);

  if (!required || state === 'ready') return children;
  const zh = locale === 'zh';
  const failed = state === 'error';
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-sm space-y-4" role={failed ? 'alert' : 'status'}>
        <h2 className="font-display text-xl font-semibold text-white">
          {failed ? (zh ? '暂时无法加载模型' : 'Models could not be loaded') : (zh ? '正在准备工作室…' : 'Preparing your studio…')}
        </h2>
        <p className="text-sm text-white/70">
          {failed ? (zh ? '请重试以查看可用模型。尚未开始生成。' : 'Try again to see the available models. No generation has started.') : (zh ? '正在检查可用模型。' : 'Checking which models are available.')}
        </p>
        {failed && <button type="button" onClick={retry} className="rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-on-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">{zh ? '重新加载模型' : 'Retry loading models'}</button>}
      </div>
    </div>
  );
}
