import type { ReactNode } from 'react';
import { RefreshCw, ChevronDown, ChevronUp, Maximize2, Minimize2, X, GripVertical } from 'lucide-react';
import type { UserRole, WindowSize } from '../types/civic';

export interface WindowFrameProps {
  id: string;
  title: string;
  category?: string;
  size: WindowSize;
  isMinimized: boolean;
  onSizeChange: (id: string, newSize: WindowSize) => void;
  onToggleMinimize: (id: string) => void;
  onClose?: (id: string) => void;
  isMaximized?: boolean;
  onToggleMaximize?: (id: string) => void;
  isClosed?: boolean;
  view?: 'overview' | 'work' | 'map' | 'activity' | 'reports' | 'operations' | 'audit' | 'areas';
  role?: UserRole;
  onMove?: (sourceId: string, targetId: string) => void;
  order?: number;
  widthSpan?: number;
  heightPx?: number;
  columnStart?: number;
  offsetY?: number;
  onResize?: (id: string, widthSpan: number, heightPx: number, columnStart: number, offsetY: number) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  badge?: ReactNode;
  children: ReactNode;
  headerAction?: ReactNode;
}

export const WindowFrame = ({
  id,
  title,
  category,
  size,
  isMinimized,
  onSizeChange,
  onToggleMinimize,
  onClose,
  isMaximized = false,
  onToggleMaximize,
  isClosed = false,
  view = 'overview',
  role = 'citizen',
  onMove,
  order,
  widthSpan,
  heightPx,
  columnStart,
  offsetY,
  onResize,
  onRefresh,
  isRefreshing = false,
  badge,
  children,
  headerAction,
}: WindowFrameProps) => {
  const viewWindows: Record<NonNullable<WindowFrameProps['view']>, Set<string>> = {
    overview: new Set(),
    work: new Set(['w-tenders']),
    map: new Set(['w-real-map']),
    activity: new Set(['w-network']),
    reports: new Set(['w-defect']),
    operations: new Set(['w-mutations']),
    audit: new Set(['w-inspector']),
    areas: new Set(['w-wards']),
  };
  if (isClosed || !viewWindows[view].has(id)) return null;
  if ((role === 'citizen' && ['w-inspector', 'w-mutations'].includes(id)) || (role === 'auditor' && id === 'w-mutations') || (role === 'contractor' && id === 'w-wards')) return null;
  if ((view === 'operations' && !['engineer', 'contractor'].includes(role)) || (view === 'audit' && !['engineer', 'auditor'].includes(role))) return null;

  const cycleSize = () => {
    if (size === '1x') onSizeChange(id, '2x');
    else if (size === '2x') onSizeChange(id, 'full');
    else onSizeChange(id, '1x');
  };
  const startMouseResize = (event: React.PointerEvent<HTMLButtonElement>, edge: string) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const baseSpan = widthSpan || (size === '1x' ? 4 : size === '2x' ? 8 : 12);
    const baseStart = columnStart || 1;
    const cardHeight = event.currentTarget.closest('.window-card')?.getBoundingClientRect().height || 300;
    const gridWidth = event.currentTarget.closest('.windows-grid')?.getBoundingClientRect().width || 1200;
    const resize = (move: PointerEvent) => {
      const dx = move.clientX - startX;
      const dy = move.clientY - startY;
      const movingLeft = edge.includes('w');
      const movingRight = edge.includes('e');
      const movingTop = edge.includes('n');
      const movingBottom = edge.includes('s');
      let nextStart = baseStart;
      let nextSpan = baseSpan;
      if (movingRight) nextSpan = Math.round(baseSpan + dx / (gridWidth / 12));
      if (movingLeft) { const columns = Math.round(dx / (gridWidth / 12)); nextStart = baseStart + columns; nextSpan = baseSpan - columns; }
      nextStart = Math.max(1, Math.min(13 - 3, nextStart));
      nextSpan = Math.max(3, Math.min(13 - nextStart, nextSpan));
      const nextHeight = Math.max(180, Math.min(1200, Math.round(cardHeight + (movingTop ? -dy : movingBottom ? dy : 0))));
      const nextOffsetY = movingTop ? (offsetY || 0) + dy : (offsetY || 0);
      const nextSize: WindowSize = nextSpan >= 9 ? 'full' : nextSpan >= 6 ? '2x' : '1x';
      onSizeChange(id, nextSize);
      onResize?.(id, nextSpan, nextHeight, nextStart, nextOffsetY);
    };
    const stop = () => { window.removeEventListener('pointermove', resize); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };

  return (
    <div className={`window-card size-${size} ${isMinimized ? 'minimized' : ''} ${isMaximized ? 'maximized' : ''}`} style={{ ...(order === undefined ? {} : { order }), ...(widthSpan ? { gridColumn: `${columnStart || 'auto'} / span ${widthSpan}` } : {}), ...(heightPx ? { height: heightPx } : {}), ...(offsetY && !isMaximized ? { translate: `0 ${offsetY}px` } : {}) }} data-window={id} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const source = event.dataTransfer.getData('text/window-id'); if (source && source !== id) onMove?.(source, id); }}>
      <div className="window-header">
        <div className="window-title">
          {onMove && <button type="button" draggable className="window-drag-grip" aria-label="Drag to reorder panel" title="Drag to reposition this panel" onDragStart={event => { event.dataTransfer.setData('text/window-id', id); event.dataTransfer.effectAllowed = 'move'; }}><GripVertical size={14} /></button>}
          <span className="tag-dot" />
          {category && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', fontWeight: 500 }}>
              [{category}]
            </span>
          )}
          <span>{title}</span>
          {badge}
        </div>

        <div className="window-actions">
          {headerAction}

          {onRefresh && (
            <button
              onClick={onRefresh}
              className="window-btn"
              title="Refresh Window Data"
              disabled={isRefreshing}
            >
              <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          )}

          <button
            onClick={cycleSize}
            className="window-btn"
            title={`Current size: ${size}. Click to cycle.`}
            style={{ fontWeight: 700, fontSize: '0.62rem' }}
          >
            {size}
          </button>

          <button
            onClick={() => onToggleMinimize(id)}
            className="window-btn"
            title={isMinimized ? 'Restore window' : 'Minimize window'}
          >
            {isMinimized ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
          {onToggleMaximize && <button onClick={() => onToggleMaximize(id)} className="window-btn" title={isMaximized ? 'Restore window size' : 'Maximize window'}>{isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>}
          {onClose && <button onClick={() => onClose(id)} className="window-btn window-close-btn" title="Close window"><X size={13} /></button>}
        </div>
      </div>

      {!isMinimized && (
        <div className="window-body">
          {children}
        </div>
      )}
      {!isMinimized && !isMaximized && <>{['n','s','e','w','ne','nw','se','sw'].map(edge => <button key={edge} type="button" className={`window-edge-handle edge-${edge}`} onPointerDown={event => startMouseResize(event, edge)} aria-label={`Drag ${edge} edge to resize panel`} title="Drag any panel edge to resize; only dashboard panels reflow" />)}</>}
    </div>
  );
};
