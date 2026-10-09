/**
 * Register workspace.
 *
 * Renders either the factory three-column till or an admin-authored atomic
 * canvas that fills the whole screen. Each element is supplied by the register
 * route (or the action registry, for admin-created buttons), so a control keeps
 * its handlers, permissions and state wherever it is placed.
 */
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { GridLayout, type Layout } from "react-grid-layout";
import { createScaledStrategy, noCompactor } from "react-grid-layout/core";
import "react-grid-layout/css/styles.css";
import {
  Eye,
  GripVertical,
  LayoutGrid,
  List,
  PanelRightOpen,
  Pencil,
  RotateCcw,
  Save,
  Settings2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/pos-auth";
import type { SellingLayout } from "@/core/types/pos-types";
import { useUiScalePrefs } from "@/lib/use-ui-scale";
import { boundedInputNumber } from "@/lib/number-input";
import {
  draggedCanvasPosition,
  paletteDropCell,
  palettePreviewOffset,
} from "@/lib/canvas-coordinates";
import {
  DEFAULT_PAD,
  ASPECT_RATIO,
  COL_CHOICES,
  MAX_PAD,
  MAX_ROW_HEIGHT,
  MIN_ROW_HEIGHT,
  isCustomId,
  isGroupId,
  nodeSpec,
  useRegisterLayout,
  type CanvasAspect,
  type CanvasConfig,
  type CustomButtonSpec,
  type LayoutBox,
  type ModuleFont,
  type ModuleOptions,
  type ModuleStyle,
  type ModuleTone,
} from "@/lib/register-layout";
import type { RegisterModuleId } from "@/lib/register-modules";
import { MODULE_BY_ID } from "@/lib/register-modules";
import { FeaturePalette } from "./FeaturePalette";
import { CustomButtonDialog } from "./CustomButtonDialog";
import { CustomActionButton } from "./CustomActionButton";
import { NodeOptionsProvider } from "./node-options";
import { RegisterZoomFitContext } from "@/lib/register-zoom-context";

export type RegisterSlots = Record<RegisterModuleId, ReactNode>;

const FONT_SCALE: Record<ModuleFont, number> = { sm: 0.85, md: 1, lg: 1.18, xl: 1.4 };

/** Tone recolours the control inside the node using semantic tokens only. */
const TONE_CLASS: Record<ModuleTone, string> = {
  neutral: "",
  primary: "[&_button]:bg-primary [&_button]:text-primary-foreground [&_button]:border-transparent",
  success: "[&_button]:bg-success [&_button]:text-success-foreground [&_button]:border-transparent",
  warning: "[&_button]:bg-warning [&_button]:text-warning-foreground [&_button]:border-transparent",
  destructive:
    "[&_button]:bg-destructive [&_button]:text-destructive-foreground [&_button]:border-transparent",
};

const DOT_GRID =
  "bg-[radial-gradient(color-mix(in_oklab,var(--primary)_28%,transparent)_1px,transparent_1px)] [background-size:13px_13px]";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Measures the live viewport the canvas has to fill. */
function useViewportBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return { ref, ...size };
}

/**
 * Uniform scale: the design is authored once on a logical canvas and every
 * monitor renders that exact composition, only bigger or smaller. No
 * breakpoints, so nothing reflows between the office PC and the till.
 */
function canvasMetrics(canvas: CanvasConfig, view: { width: number; height: number }) {
  const ratio = ASPECT_RATIO[canvas.aspect];
  const baseWidth = canvas.baseWidth;
  const width = view.width || baseWidth;
  const height = view.height || Math.round(baseWidth / (ratio ?? 16 / 9));
  const baseHeight = ratio
    ? Math.round(baseWidth / ratio)
    : Math.max(1, Math.round(height / (width / baseWidth)));
  const scale = ratio ? Math.min(width / baseWidth, height / baseHeight) : width / baseWidth;
  return { baseWidth, baseHeight, scale: Math.max(0.2, scale) };
}

export function RegisterWorkspace({
  canvasNavigation,
  slots,
  terminalKey,
  classic,
  mode,
  onModeChange,
}: {
  canvasNavigation?: ReactNode;
  slots: RegisterSlots;
  terminalKey: string;
  /** The untouched factory screen, used whenever no custom layout is saved. */
  classic: ReactNode;
  /** Optional preference. When absent, an existing saved canvas remains active. */
  mode?: SellingLayout;
  onModeChange?: (mode: SellingLayout) => void;
}) {
  const { isAdmin, can } = useAuth();
  const { registerZoom } = useUiScalePrefs();
  const layout = useRegisterLayout(terminalKey);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [dragging, setDragging] = useState<RegisterModuleId | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const view = useViewportBox();
  const gridHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPaletteOpen(false);
    setCreateOpen(false);
    setDragging(null);
    setSelected([]);
  }, [terminalKey]);

  /**
   * Container-relative drag math.
   *
   * The stock scaled strategy divides the pointer's *viewport* position by the
   * scale, so a canvas that starts below the header makes every tile jump by
   * the header's height the moment it is grabbed. Rebasing against the live
   * `getBoundingClientRect()` of the canvas — and only then dividing by the
   * scale — keeps the grab point exactly under the cursor at any zoom, scroll
   * position or window size.
   */
  const containerStrategy = useCallback(
    (scale: number, logicalWidth: number, logicalHeight: number) => ({
      ...createScaledStrategy(scale),
      calcDragPosition: (clientX: number, clientY: number, offsetX: number, offsetY: number) => {
        const rect = gridHostRef.current?.getBoundingClientRect();
        if (!rect) return { left: (clientX - offsetX) / scale, top: (clientY - offsetY) / scale };
        return draggedCanvasPosition(
          clientX,
          clientY,
          offsetX,
          offsetY,
          rect,
          logicalWidth,
          logicalHeight,
        );
      },
    }),
    [],
  );

  const editing = isAdmin && layout.editing;
  const effectiveMode: SellingLayout = mode ?? (layout.saved ? "canvas" : "standard");
  const showCanvas =
    !!layout.active &&
    (editing || layout.previewing || (effectiveMode === "canvas" && !!layout.saved));
  const setZoomFit = useContext(RegisterZoomFitContext);
  useEffect(() => {
    setZoomFit(!showCanvas);
    return () => setZoomFit(false);
  }, [showCanvas, setZoomFit]);
  const canvas = layout.active?.canvas;
  const metrics = useMemo(
    () => (canvas ? canvasMetrics(canvas, { width: view.width, height: view.height }) : null),
    [canvas, view.width, view.height],
  );
  const effectiveScale = (metrics?.scale ?? 1) * registerZoom;

  const boxes = useMemo<Layout>(
    () =>
      (layout.active?.items ?? []).map((it) => {
        const spec = nodeSpec(it);
        return {
          i: it.i,
          x: it.x,
          y: it.y,
          w: it.w,
          h: it.h,
          minW: spec?.minW ?? 1,
          minH: spec?.minH ?? 1,
          static: !editing,
        };
      }),
    [layout.active, editing],
  );

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col">
      {showCanvas && canvasNavigation && (
        <div className="shrink-0 border-b border-border px-2 py-1">{canvasNavigation}</div>
      )}
      {(isAdmin || can("can_access_pos_settings")) && layout.loaded && (
        <CustomizeBar
          editing={editing}
          previewing={layout.previewing}
          custom={!!layout.saved}
          canvas={canvas ?? null}
          scale={metrics?.scale ?? 1}
          mode={effectiveMode}
          canEdit={isAdmin}
          onModeChange={(next) => {
            if (next === "canvas" && !layout.saved) {
              if (!isAdmin) {
                toast.info("An administrator must create this terminal's Custom Canvas first.");
                return;
              }
              onModeChange?.("canvas");
              layout.startEdit();
              setPaletteOpen(true);
              return;
            }
            onModeChange?.(next);
          }}
          onCanvas={layout.setCanvas}
          onEdit={() => {
            layout.startEdit();
            setPaletteOpen(true);
          }}
          onCancel={() => {
            layout.stopEdit();
            setPaletteOpen(false);
            setDragging(null);
            setSelected([]);
          }}
          onPalette={() => setPaletteOpen((v) => !v)}
          onPadAll={layout.setAllPadding}
          onPreview={layout.preview}
          onResume={layout.resumeEdit}
          saving={layout.saving}
          onSave={async () => {
            const saved = await layout.save();
            if (!saved) {
              toast.error("The layout could not be saved on this terminal. Please try again.");
              return;
            }
            setPaletteOpen(false);
            setDragging(null);
            setSelected([]);
            onModeChange?.("canvas");
            toast.success("Layout saved for this terminal");
          }}
          onReset={async () => {
            const reset = await layout.reset();
            if (!reset) {
              toast.error("The saved layout could not be cleared. Please try again.");
              return;
            }
            setPaletteOpen(false);
            setDragging(null);
            setSelected([]);
            onModeChange?.("standard");
            toast.success("Custom Canvas deleted; Standard POS is active");
          }}
        />
      )}

      <FeaturePalette
        open={isAdmin && editing && paletteOpen}
        onOpenChange={(open) => {
          setPaletteOpen(open);
          if (!open) setDragging(null);
        }}
        modules={layout.palette}
        onAdd={(id) => layout.addModule(id)}
        onDragStart={setDragging}
        onDragEnd={() => setDragging(null)}
        onCreate={() => setCreateOpen(true)}
        onAddGroup={() => {
          const groupable = selected.filter((id) =>
            layout.active?.items.some((item) => item.i === id && !isGroupId(item.i)),
          );
          if (!groupable.length) {
            toast.warning("Please select at least one item to group.");
            return;
          }
          layout.addGroup(groupable);
          setSelected([]);
          toast.success(`Grouped ${groupable.length} item${groupable.length > 1 ? "s" : ""}`);
        }}
      />

      <CustomButtonDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(spec: CustomButtonSpec, opts) => {
          layout.addCustom(spec, opts);
          setCreateOpen(false);
          toast.success(`${spec.label} added to the canvas`);
        }}
      />

      {!showCanvas ? (
        <div className="register-standard-viewport min-h-0 w-full flex-1">{classic}</div>
      ) : (
        <div
          ref={view.ref}
          className={`min-h-0 w-full flex-1 overflow-hidden bg-background ${editing ? DOT_GRID : ""}`}
          onDragOver={(e) => {
            if (editing && dragging) e.preventDefault();
          }}
        >
          {canvas && metrics && (
            <div
              ref={gridHostRef}
              className="origin-top-left"
              style={{
                width: metrics.baseWidth,
                height: metrics.baseHeight,
                transform: `scale(${metrics.scale})`,
              }}
            >
              <GridLayout
                width={metrics.baseWidth}
                className="pos-scaled"
                style={{ height: metrics.baseHeight }}
                autoSize={false}
                layout={boxes}
                compactor={noCompactor}
                positionStrategy={containerStrategy(
                  effectiveScale,
                  metrics.baseWidth,
                  metrics.baseHeight,
                )}
                gridConfig={{
                  cols: canvas.cols,
                  rowHeight: canvas.rowHeight,
                  margin: [0, 0],
                  containerPadding: [0, 0],
                }}
                dragConfig={{ enabled: editing, handle: ".rgl-drag-handle" }}
                resizeConfig={{ enabled: editing }}
                dropConfig={{
                  enabled: editing,
                  ...(dragging
                    ? {
                        defaultItem: { w: MODULE_BY_ID[dragging].w, h: MODULE_BY_ID[dragging].h },
                        onDragOver: () => {
                          const rect = gridHostRef.current?.getBoundingClientRect();
                          if (!rect) return;
                          const def = MODULE_BY_ID[dragging];
                          const offset = palettePreviewOffset(
                            rect,
                            metrics.baseWidth,
                            metrics.baseHeight,
                            (def.w * metrics.baseWidth) / canvas.cols,
                            def.h * canvas.rowHeight,
                          );
                          return { dragOffsetX: offset.x, dragOffsetY: offset.y };
                        },
                      }
                    : {}),
                }}
                onDrop={(_l, item, event) => {
                  if (!dragging) return;
                  const rect = gridHostRef.current?.getBoundingClientRect();
                  const def = MODULE_BY_ID[dragging];
                  const pointer = event as DragEvent;
                  const position = rect
                    ? paletteDropCell({
                        clientX: pointer.clientX,
                        clientY: pointer.clientY,
                        rect,
                        logicalWidth: metrics.baseWidth,
                        logicalHeight: metrics.baseHeight,
                        cols: canvas.cols,
                        rowHeight: canvas.rowHeight,
                        itemW: def.w,
                        itemH: def.h,
                      })
                    : { x: item?.x ?? 0, y: item?.y ?? 0 };
                  layout.addModule(dragging, position);
                  setDragging(null);
                }}
                onLayoutChange={(next: Layout) => {
                  if (editing)
                    layout.applyBoxes(
                      next.map((b) => ({ i: String(b.i), x: b.x, y: b.y, w: b.w, h: b.h })),
                    );
                }}
              >
                {(layout.active?.items ?? []).map((box) => (
                  <div
                    key={box.i}
                    className={`min-h-0 min-w-0 ${isGroupId(box.i) ? "z-0" : "z-10"}`}
                  >
                    <CanvasItem
                      box={box}
                      editing={editing}
                      selected={selected.includes(box.i)}
                      onSelect={(additive) =>
                        setSelected((prev) =>
                          additive
                            ? prev.includes(box.i)
                              ? prev.filter((id) => id !== box.i)
                              : [...prev, box.i]
                            : prev.length === 1 && prev[0] === box.i
                              ? []
                              : [box.i],
                        )
                      }
                      onRemove={() => {
                        const spec = nodeSpec(box);
                        if (spec?.essential) {
                          toast.warning(
                            `${spec.label} removed — the till cannot take payment without it.`,
                          );
                        }
                        setSelected((prev) => prev.filter((id) => id !== box.i));
                        layout.removeModule(box.i);
                      }}
                      onOptions={(opts) => layout.setOptions(box.i, opts)}
                    >
                      {isGroupId(box.i) ? null : isCustomId(box.i) && box.custom ? (
                        <CustomActionButton spec={box.custom} />
                      ) : (
                        slots[box.i as RegisterModuleId]
                      )}
                    </CanvasItem>
                  </div>
                ))}
              </GridLayout>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Sizes the node content to whatever space is left inside the padding, so an
 * icon-only tile shrunk to one grid cell has no dead space around its glyph.
 */
function useAutoScale(pad: number, font: ModuleFont, bare: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [vars, setVars] = useState<CSSProperties>({});
  useEffect(() => {
    const el = ref.current;
    if (!el || !bare) return;
    const measure = () => {
      const w = el.clientWidth - pad * 2;
      const h = el.clientHeight - pad * 2;
      if (w <= 0 || h <= 0) return;
      const base = Math.min(w, h);
      const scale = FONT_SCALE[font];
      setVars({
        ["--node-icon" as string]: `${clamp(base * 0.5, 12, 44) * scale}px`,
        ["--node-font" as string]: `${clamp(base * 0.22, 9, 20) * scale}px`,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pad, font, bare]);
  return { ref, vars };
}

function CanvasItem({
  box,
  editing,
  selected,
  onSelect,
  onRemove,
  onOptions,
  children,
}: {
  box: LayoutBox;
  editing: boolean;
  selected: boolean;
  onSelect: (additive: boolean) => void;
  onRemove: () => void;
  onOptions: (opts: ModuleOptions) => void;
  children: ReactNode;
}) {
  const def = nodeSpec(box);
  const pad = box.pad ?? DEFAULT_PAD;
  const bare = def?.chrome === "bare";
  const group = isGroupId(box.i);
  const { ref, vars } = useAutoScale(pad, box.font ?? "md", bare);
  if (!def) return null;
  const panel = !bare;
  /* Panel tiles (cart, catalogue, totals …) cannot shrink-to-fit like an icon
     tile, so the font size scales their whole content instead — the tile keeps
     its own scroll area, the text inside simply reads bigger or smaller. */
  const panelScale = FONT_SCALE[box.font ?? "md"];
  return (
    <section
      ref={ref}
      style={{ padding: pad, ...vars }}
      onPointerDownCapture={(e) => {
        if (!editing) return;
        if ((e.target as HTMLElement).closest("button,[role='button'],input,select,textarea"))
          return;
        onSelect(e.ctrlKey || e.metaKey || e.shiftKey);
      }}
      className={`group relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden ${
        group
          ? `rounded-xl border border-dashed border-primary/40 bg-primary/5 ${editing ? "" : "pointer-events-none"}`
          : panel
            ? "rounded-lg border border-border bg-card"
            : ""
      } ${editing && !group ? "rounded-lg outline-2 outline-dashed outline-primary/50" : ""} ${
        editing && selected ? "ring-2 ring-primary ring-offset-1" : ""
      } ${TONE_CLASS[box.tone ?? "neutral"]}`}
      data-view={box.view ?? "list"}
    >
      {group && (box.title || box.label) && (
        <p className="pointer-events-none absolute left-2 top-1 text-[11px] font-semibold uppercase tracking-wide text-primary/70">
          {box.label || box.title}
        </p>
      )}
      {editing && (
        <div className="absolute right-1 top-1 z-20 flex items-center gap-0.5 rounded-md border border-primary/40 bg-background/95 px-1 py-0.5 opacity-70 shadow-sm transition-opacity group-hover:opacity-100">
          <span
            className="rgl-drag-handle flex cursor-grab items-center px-0.5 text-primary active:cursor-grabbing"
            title={def.label}
          >
            <GripVertical className="size-3.5" />
          </span>
          <Inspector
            box={box}
            label={def.label}
            supportsView={def.supportsView}
            supportsLabel={def.supportsLabel}
            supportsStyle={bare}
            onOptions={onOptions}
          />
          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-destructive hover:text-destructive"
            aria-label={`Remove ${def.label}`}
            onClick={onRemove}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}
      <div
        className={`min-h-0 flex-1 ${panel ? "overflow-auto" : "overflow-hidden"}`}
        {...(panel && panelScale !== 1 ? { style: { zoom: panelScale } as CSSProperties } : {})}
      >
        <NodeOptionsProvider
          value={{
            ...(box.label ? { label: box.label } : {}),
            ...(box.style ? { style: box.style } : {}),
            ...(bare ? { fill: true } : {}),
          }}
        >
          {children}
        </NodeOptionsProvider>
      </div>
    </section>
  );
}

function Inspector({
  box,
  label,
  supportsView,
  supportsLabel,
  supportsStyle,
  onOptions,
}: {
  box: LayoutBox;
  label: string;
  supportsView: boolean;
  supportsLabel: boolean;
  /** Only icon-style controls can honour icon / text / icon + text. */
  supportsStyle: boolean;
  onOptions: (opts: ModuleOptions) => void;
}) {
  const pad = box.pad ?? DEFAULT_PAD;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="size-6" aria-label={`${label} options`}>
          <Settings2 className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {supportsLabel && (
          <div>
            <p className="mb-1 text-[11px] text-muted-foreground">Custom label</p>
            <Input
              value={box.custom ? box.custom.label : (box.label ?? "")}
              placeholder={label}
              className="h-8 text-sm"
              onChange={(e) =>
                onOptions(
                  box.custom
                    ? { custom: { ...box.custom, label: e.target.value } }
                    : { label: e.target.value },
                )
              }
            />
          </div>
        )}
        {supportsView && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              View
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={(box.view ?? "list") === "grid" ? "default" : "outline"}
                className="h-8 flex-1"
                onClick={() => onOptions({ view: "grid" })}
              >
                <LayoutGrid className="size-3.5" /> Grid
              </Button>
              <Button
                size="sm"
                variant={(box.view ?? "list") === "list" ? "default" : "outline"}
                className="h-8 flex-1"
                onClick={() => onOptions({ view: "list" })}
              >
                <List className="size-3.5" /> List
              </Button>
            </div>
          </div>
        )}
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Colour tone
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(["neutral", "primary", "success", "warning", "destructive"] as ModuleTone[]).map(
              (t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={(box.tone ?? "neutral") === t ? "default" : "outline"}
                  className="h-7 px-2 text-[11px] capitalize"
                  onClick={() => onOptions({ tone: t })}
                >
                  {t}
                </Button>
              ),
            )}
          </div>
        </div>
        {supportsStyle && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Display
            </p>
            <div className="flex gap-1.5">
              {(
                [
                  ["both", "Icon + text"],
                  ["text", "Text only"],
                  ["icon", "Icon only"],
                ] as [ModuleStyle, string][]
              ).map(([v, l]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={(box.style ?? "both") === v ? "default" : "outline"}
                  className="h-7 flex-1 px-1 text-[11px]"
                  onClick={() => onOptions({ style: v })}
                >
                  {l}
                </Button>
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Font size
          </p>
          <div className="flex gap-1.5">
            {(["sm", "md", "lg", "xl"] as ModuleFont[]).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={(box.font ?? "md") === f ? "default" : "outline"}
                className="h-7 flex-1 px-1 text-[11px]"
                onClick={() => onOptions({ font: f })}
              >
                {f === "sm" ? "S" : f === "md" ? "M" : f === "lg" ? "L" : "XL"}
              </Button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Inner padding — {pad}px
          </p>
          <input
            type="range"
            min={0}
            max={MAX_PAD}
            step={1}
            value={pad}
            className="w-full accent-primary"
            aria-label="Inner padding"
            onChange={(e) =>
              onOptions({ pad: boundedInputNumber(e.target.value, pad, 0, MAX_PAD, true) })
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CustomizeBar({
  editing,
  previewing,
  custom,
  canvas,
  scale,
  mode,
  canEdit,
  onModeChange,
  onCanvas,
  onEdit,
  onCancel,
  onPalette,
  onPadAll,
  onPreview,
  onResume,
  onSave,
  onReset,
  saving,
}: {
  editing: boolean;
  previewing: boolean;
  custom: boolean;
  canvas: CanvasConfig | null;
  scale: number;
  mode: SellingLayout;
  canEdit: boolean;
  onModeChange: (mode: SellingLayout) => void;
  onCanvas: (patch: Partial<CanvasConfig>) => void;
  onEdit: () => void;
  onCancel: () => void;
  onPalette: () => void;
  onPadAll: (pad: number) => void;
  onPreview: () => void;
  onResume: () => void;
  onSave: () => void | Promise<void>;
  onReset: () => void | Promise<void>;
  saving: boolean;
}) {
  // Live mode keeps every pixel for the till: the entry point floats instead of
  // taking a full toolbar row.
  if (!editing && !previewing) {
    return (
      <div className="absolute right-2 top-2 z-40 flex items-center gap-1 rounded-lg border border-border bg-background/90 p-1 opacity-75 shadow-sm backdrop-blur transition-opacity hover:opacity-100">
        <Button
          size="sm"
          variant={mode === "standard" ? "default" : "ghost"}
          className="h-7 px-2 text-[11px]"
          onClick={() => onModeChange("standard")}
        >
          Standard POS
        </Button>
        <Button
          size="sm"
          variant={mode === "canvas" ? "default" : "ghost"}
          className="h-7 px-2 text-[11px]"
          onClick={() => onModeChange("canvas")}
        >
          Custom Canvas
        </Button>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={onEdit}
          >
            <Pencil className="size-3" /> {custom ? "Edit" : "Create"}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-primary/40 bg-primary/10 px-3 py-1.5">
      <span className="mr-auto text-[11px] font-semibold uppercase tracking-wide text-primary">
        {previewing
          ? "Live preview — tap controls to test"
          : "Edit mode — drag, resize, restyle or remove elements"}
      </span>
      {editing && (
        <>
          <Button size="sm" variant="outline" className="h-8" onClick={onPalette}>
            <PanelRightOpen className="size-3.5" /> Feature hub
          </Button>
          {canvas && (
            <>
              <label className="flex items-center gap-1 text-[11px] text-primary">
                Columns
                <select
                  value={canvas.cols}
                  className="h-8 rounded-md border border-border bg-background px-1 text-xs"
                  aria-label="Canvas columns"
                  onChange={(e) =>
                    onCanvas({
                      cols: boundedInputNumber(e.target.value, canvas.cols, 1, 64, true),
                    })
                  }
                >
                  {COL_CHOICES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1 text-[11px] text-primary">
                Row px
                <input
                  type="number"
                  min={MIN_ROW_HEIGHT}
                  max={MAX_ROW_HEIGHT}
                  value={canvas.rowHeight}
                  className="h-8 w-14 rounded-md border border-border bg-background px-2 text-xs"
                  aria-label="Canvas row height"
                  onChange={(e) =>
                    onCanvas({
                      rowHeight: boundedInputNumber(
                        e.target.value,
                        canvas.rowHeight,
                        MIN_ROW_HEIGHT,
                        MAX_ROW_HEIGHT,
                        true,
                      ),
                    })
                  }
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-primary">
                Design width
                <input
                  type="number"
                  min={800}
                  max={3840}
                  step={80}
                  value={canvas.baseWidth}
                  className="h-8 w-20 rounded-md border border-border bg-background px-2 text-xs"
                  aria-label="Canvas design width"
                  onChange={(e) =>
                    onCanvas({
                      baseWidth: boundedInputNumber(
                        e.target.value,
                        canvas.baseWidth,
                        800,
                        3840,
                        true,
                      ),
                    })
                  }
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-primary">
                Aspect
                <select
                  value={canvas.aspect}
                  className="h-8 rounded-md border border-border bg-background px-1 text-xs"
                  aria-label="Canvas aspect lock"
                  onChange={(e) => onCanvas({ aspect: e.target.value as CanvasAspect })}
                >
                  <option value="free">Fill screen</option>
                  <option value="16:9">16:9</option>
                  <option value="4:3">4:3</option>
                </select>
              </label>
              <span className="rounded-md bg-primary/15 px-2 py-1 text-[11px] font-semibold text-primary">
                {Math.round(scale * 100)}%
              </span>
            </>
          )}
          <label className="flex items-center gap-1 text-[11px] text-primary">
            Padding
            <input
              type="number"
              min={0}
              max={MAX_PAD}
              defaultValue={DEFAULT_PAD}
              className="h-8 w-14 rounded-md border border-border bg-background px-2 text-xs"
              aria-label="Padding for every element"
              onChange={(e) =>
                onPadAll(boundedInputNumber(e.target.value, DEFAULT_PAD, 0, MAX_PAD, true))
              }
            />
          </label>
        </>
      )}
      {editing ? (
        <Button size="sm" variant="outline" className="h-8" onClick={onPreview}>
          <Eye className="size-3.5" /> Live preview
        </Button>
      ) : (
        <Button size="sm" variant="outline" className="h-8" onClick={onResume}>
          <Pencil className="size-3.5" /> Back to editing
        </Button>
      )}
      <Button size="sm" variant="outline" className="h-8" disabled={saving} onClick={onReset}>
        <RotateCcw className="size-3.5" /> Delete custom layout
      </Button>
      <Button size="sm" className="h-8" disabled={saving} onClick={onSave}>
        <Save className="size-3.5" /> {saving ? "Saving…" : "Save layout"}
      </Button>
      <Button size="sm" variant="ghost" className="h-8" disabled={saving} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
