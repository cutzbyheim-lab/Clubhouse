import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { UpdateStatus } from '@shared/ipc/contract';
import { call } from '@/lib/api';

/** Version line in the rail; turns into a restart button when an update is ready. */
export function UpdateBadge({ collapsed }: { collapsed: boolean }) {
  const [s, setS] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    let live = true;
    const poll = async () => {
      const res = await call('app.updateStatus', {});
      if (live && res.ok) setS(res.data);
    };
    void poll();
    const id = window.setInterval(() => void poll(), 15000);
    window.addEventListener('focus', poll);
    return () => {
      live = false;
      window.clearInterval(id);
      window.removeEventListener('focus', poll);
    };
  }, []);

  if (!s) return null;

  if (s.state === 'ready') {
    return (
      <button
        type="button"
        onClick={() => void call('app.installUpdate', {})}
        title={`Version ${s.availableVersion ?? ''} is ready`}
        className="mx-2 mb-1 flex items-center gap-2 rounded-control border border-green-speed/50 bg-fairway-deep px-2.5 py-2 text-left text-sm text-ink hover:bg-fairway"
      >
        <RefreshCw size={15} className="shrink-0 text-green-speed" aria-hidden />
        {!collapsed && (
          <span className="leading-tight">
            Restart to update
            <span className="block text-xs text-ink-muted">Version {s.availableVersion}</span>
          </span>
        )}
      </button>
    );
  }

  if (collapsed) return null;
  return (
    <div className="mx-3 mb-1 flex items-center gap-1.5 text-xs text-ink-faint" title={s.state === 'error' ? s.message : undefined}>
      {s.state === 'downloading' && <Download size={12} className="text-green-speed" aria-hidden />}
      <span className="figures">v{s.currentVersion}</span>
      {s.state === 'downloading' && <span>· downloading update {s.percent ?? 0}%</span>}
      {s.state === 'checking' && <span>· checking for updates</span>}
      {s.state === 'current' && <span>· up to date</span>}
      {s.state === 'disabled' && <span>· development</span>}
    </div>
  );
}
