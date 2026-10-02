import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';

export type Tab = { id: string; label: string; content: ReactNode };

/** Pestañas accesibles (flechas para moverse entre ellas); solo se monta la activa. */
export function Tabs({ label, tabs }: { label: string; tabs: Tab[] }) {
  const base = useId();
  const [selected, setSelected] = useState(tabs[0]?.id ?? '');
  const current = tabs.find((tab) => tab.id === selected) ?? tabs[0];
  if (!current) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = tabs.findIndex((tab) => tab.id === current.id);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
    setSelected(next.id);
    document.getElementById(`${base}-tab-${next.id}`)?.focus();
  };

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-1 border-b"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`${base}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={tab.id === current.id}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={tab.id === current.id ? 0 : -1}
            onClick={() => setSelected(tab.id)}
            className={`rounded-t px-3 py-1 text-sm ${
              tab.id === current.id ? 'border border-b-0 font-semibold' : 'text-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel-${current.id}`}
        aria-labelledby={`${base}-tab-${current.id}`}
      >
        {current.content}
      </div>
    </div>
  );
}
