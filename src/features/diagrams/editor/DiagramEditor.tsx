import '@xyflow/react/dist/base.css'
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { toast } from 'sonner'
import type { Json } from '@/types/database.types'
import { cn } from '@/lib/utils'
import { DiagramEditorContext } from './context'
import { edgeTypes, flowStyle, nodeTypes } from './flowTypes'
import { GuideLines } from './GuideLines'
import { HIGHLIGHTER_SIZE, PEN_SIZES } from './ink'
import { InkLayer, type DrawTool } from './InkLayer'
import { snapToGuides, type Guides } from './guides'
import { findMermaid } from './mermaid/detect'
import { importSummary, skippedSummary } from './mermaid/summary'
import { MermaidImportDialog, type ImportedDiagram } from './MermaidImportDialog'
import {
  createEdge,
  createInk,
  createNode,
  normalizeOrder,
  parse,
  serialize,
  withDescendants,
  type ColorKey,
  type ConnectorData,
  type DiagramContent,
  type DiagramEdge,
  type DiagramNode,
  type DiagramNodeData,
  type LibraryItem,
} from './model'
import { PropertiesPanel, type Alignment } from './PropertiesPanel'
import { LIBRARY_DRAG_TYPE, ShapePanel } from './ShapePanel'
import { readRecent, toLibraryItem, withoutRecent, withRecent } from './recent'
import { Toolbar } from './Toolbar'
import { useHistory } from './useHistory'

const GRID = 16
const PROPERTIES_KEY = 'devdock-diagram-properties'
const SNAP_KEY = 'devdock-diagram-snap'
const FINE_GRID_KEY = 'devdock-diagram-fine-grid'
const INK_KEY = 'devdock-whiteboard-ink'
const PASTE_OFFSET = 24
/** Starts what the editor puts on the clipboard, so a paste can tell its own content from any other text. */
const CLIP_MARKER = 'devdock-diagram/v1\n'
/** A larger paste is refused: nobody copies this much from one diagram. */
const MAX_CLIP_CHARS = 2_000_000

const snapValue = (v: number) => Math.round(v / GRID) * GRID

type Rect = { x: number; y: number; w: number; h: number }
type Clip = { nodes: DiagramNode[]; edges: DiagramEdge[] }

const readStored = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable (private mode): the choice lasts for this visit only.
  }
}

type DiagramEditorProps = {
  initial: DiagramContent
  readOnly: boolean
  /** Called with the saveable JSON whenever the diagram's content changes. */
  onChange: (data: Json) => void
  fullscreen: boolean
  onFullscreen: (on: boolean) => void
}

/** The Lucid-style editor: shape library | canvas | properties. */
export function DiagramEditor(props: DiagramEditorProps) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  )
}

function Editor({ initial, readOnly, onChange, fullscreen, onFullscreen }: DiagramEditorProps) {
  const flow = useReactFlow<DiagramNode, DiagramEdge>()
  const [nodes, setNodes] = useState(initial.nodes)
  const [edges, setEdges] = useState(initial.edges)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [guides, setGuides] = useState<Guides | null>(null)
  // Remembered in this browser, like the properties panel.
  const [snapToGrid, setSnapToGridState] = useState(() => readStored(SNAP_KEY) === 'on')
  const setSnapToGrid = (on: boolean) => {
    setSnapToGridState(on)
    store(SNAP_KEY, on ? 'on' : 'off')
    // Nothing on the canvas moves when it's switched: say what changed.
    toast(on ? 'Snap to grid on' : 'Snap to grid off', {
      id: 'diagram-snap',
      description: on
        ? `Shapes now move, resize and nudge in ${GRID} px steps, so they line up on the grid.`
        : 'Shapes move freely again, with alignment guides to other shapes.',
    })
  }
  // The 16 px lines are dense, so they're opt-in (the 64 px ones always show while snapping).
  const [fineGrid, setFineGridState] = useState(() => readStored(FINE_GRID_KEY) === 'on')
  const setFineGrid = (on: boolean) => {
    setFineGridState(on)
    store(FINE_GRID_KEY, on ? 'on' : 'off')
  }
  // Collapsing the properties panel is a per-viewer preference, remembered in this browser.
  const [propertiesOpen, setPropertiesOpen] = useState(() => {
    try {
      return localStorage.getItem(PROPERTIES_KEY) !== 'closed'
    } catch {
      return true
    }
  })
  const toggleProperties = () => {
    const next = !propertiesOpen
    setPropertiesOpen(next)
    try {
      localStorage.setItem(PROPERTIES_KEY, next ? 'open' : 'closed')
    } catch {
      // Storage unavailable (private mode): the choice lasts for this visit only.
    }
  }
  // ---- drawing: the tool in hand, and the pen's and highlighter's color and the pen's size (remembered here)
  const [tool, setToolState] = useState<'select' | DrawTool>('select')
  const [ink, setInkState] = useState<{ pen: ColorKey; highlighter: ColorKey; size: number }>(() => {
    try {
      const saved = JSON.parse(readStored(INK_KEY) ?? 'null') as { pen?: ColorKey; highlighter?: ColorKey; size?: number } | null
      return {
        pen: saved?.pen ?? 'default',
        highlighter: saved?.highlighter ?? 'amber',
        size: PEN_SIZES.includes(saved?.size as (typeof PEN_SIZES)[number]) ? (saved?.size as number) : PEN_SIZES[1],
      }
    } catch {
      return { pen: 'default', highlighter: 'amber', size: PEN_SIZES[1] }
    }
  })
  const setInk = (patch: Partial<typeof ink>) => {
    const next = { ...ink, ...patch }
    setInkState(next)
    store(INK_KEY, JSON.stringify(next))
  }
  const drawing = tool !== 'select'
  const setTool = (next: 'select' | DrawTool) => {
    setToolState(next)
    // Drawing starts from a clean slate: nothing stays selected under the pen.
    if (next !== 'select') {
      setNodes((ns) => (ns.some((n) => n.selected) ? ns.map((n) => (n.selected ? { ...n, selected: false } : n)) : ns))
      setEdges((es) => (es.some((e) => e.selected) ? es.map((e) => (e.selected ? { ...e, selected: false } : e)) : es))
      setEditingId(null)
    }
  }
  const addStroke = (points: number[][], pressure: boolean) => {
    if (tool !== 'pen' && tool !== 'highlighter') return
    snapshot()
    const size = tool === 'pen' ? ink.size : HIGHLIGHTER_SIZE
    setNodes((ns) => [...ns, createInk(points, tool, size, pressure, ink[tool])])
  }
  const eraseStrokes = (ids: string[]) => {
    const gone = new Set(ids)
    setNodes((ns) => ns.filter((n) => !gone.has(n.id)))
  }

  const canvas = useRef<HTMLDivElement>(null)
  // The panel's "Recently used" (this browser only).
  const [recent, setRecent] = useState(readRecent)

  const history = useHistory(
    useCallback(() => ({ nodes: flow.getNodes(), edges: flow.getEdges() }), [flow]),
    useCallback(({ nodes, edges }: DiagramContent) => {
      setNodes(nodes)
      setEdges(edges)
    }, []),
  )
  const { snapshot } = history

  // ------------------------------------------------------------ change → save
  const lastSaved = useRef<string | null>(null)
  useEffect(() => {
    const data = serialize({ nodes, edges })
    const text = JSON.stringify(data)
    if (lastSaved.current !== null && text !== lastSaved.current) onChange(data)
    lastSaved.current = text
  }, [nodes, edges, onChange])

  // A newer version from the server (only passed when nothing here is unsaved):
  // show it in place, keeping the viewport, without reporting it as an edit.
  const shown = useRef(initial)
  useEffect(() => {
    if (shown.current === initial) return
    shown.current = initial
    lastSaved.current = JSON.stringify(serialize(initial))
    setNodes(initial.nodes)
    setEdges(initial.edges)
  }, [initial])

  // ------------------------------------------------------------ geometry
  const rectOf = useCallback(
    (id: string): Rect | null => {
      const n = flow.getInternalNode(id)
      if (!n) return null
      const { x, y } = n.internals.positionAbsolute
      return { x, y, w: n.measured.width ?? n.width ?? 0, h: n.measured.height ?? n.height ?? 0 }
    },
    [flow],
  )

  /** Smallest container (not in `blocked`) whose box holds the rect's center, and that's bigger than it. */
  const findContainer = useCallback(
    (rect: Rect, blocked: Set<string>): { id: string; rect: Rect } | null => {
      const cx = rect.x + rect.w / 2
      const cy = rect.y + rect.h / 2
      let best: { id: string; rect: Rect } | null = null
      for (const n of flow.getNodes()) {
        if (n.type !== 'container' || blocked.has(n.id)) continue
        const r = rectOf(n.id)
        if (!r || r.w * r.h <= rect.w * rect.h) continue
        if (cx < r.x || cx > r.x + r.w || cy < r.y || cy > r.y + r.h) continue
        if (!best || r.w * r.h < best.rect.w * best.rect.h) best = { id: n.id, rect: r }
      }
      return best
    },
    [flow, rectOf],
  )

  /** After a move: put nodes into (or take them out of) the container under them, like Lucid. */
  const reparent = useCallback(
    (ids: string[]) => {
      const all = flow.getNodes()
      const moving = new Set(ids)
      const updates = new Map<string, { parentId: string | undefined; position: XYPosition }>()
      for (const id of ids) {
        const node = all.find((n) => n.id === id)
        const rect = rectOf(id)
        if (!node || !rect) continue
        if (node.parentId && moving.has(node.parentId)) continue // moves with its parent
        const target = findContainer(rect, withDescendants([id], all))
        if (target?.id === node.parentId) continue
        updates.set(id, {
          parentId: target?.id,
          position: target ? { x: rect.x - target.rect.x, y: rect.y - target.rect.y } : { x: rect.x, y: rect.y },
        })
      }
      if (updates.size === 0) return
      setNodes((ns) =>
        normalizeOrder(
          ns.map((n) => {
            const u = updates.get(n.id)
            return u ? { ...n, parentId: u.parentId, position: u.position } : n
          }),
        ),
      )
    },
    [flow, rectOf, findContainer],
  )

  // ------------------------------------------------------------ React Flow events
  const onNodesChange = useCallback(
    (changes: NodeChange<DiagramNode>[]) => {
      let next = changes
      const [change] = changes
      // Alignment guides while dragging a single node.
      if (!snapToGrid && changes.length === 1 && change.type === 'position' && change.dragging && change.position) {
        const node = flow.getInternalNode(change.id)
        const self = rectOf(change.id)
        if (node && self) {
          const parent = node.parentId ? rectOf(node.parentId) : null
          const offset = { x: parent?.x ?? 0, y: parent?.y ?? 0 }
          const blocked = withDescendants([change.id], flow.getNodes())
          const others = flow
            .getNodes()
            .filter((n) => !blocked.has(n.id))
            .flatMap((n) => flow.getInternalNode(n.id) ?? [])
          const snapped = snapToGuides(
            { x: change.position.x + offset.x, y: change.position.y + offset.y, w: self.w, h: self.h },
            others,
            6 / flow.getZoom(),
          )
          next = [{ ...change, position: { x: snapped.x - offset.x, y: snapped.y - offset.y } }]
          setGuides(snapped.guides.x === undefined && snapped.guides.y === undefined ? null : snapped.guides)
        }
      } else if (changes.some((c) => c.type === 'position' && !c.dragging)) {
        setGuides(null)
      }
      setNodes((ns) => applyNodeChanges(next, ns))
    },
    [flow, rectOf, snapToGrid],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<DiagramEdge>[]) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      snapshot()
      const edge = { ...createEdge(c.source, c.target, c.sourceHandle, c.targetHandle), selected: true }
      setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)))
      setEdges((es) => [...es.map((e) => (e.selected ? { ...e, selected: false } : e)), edge])
    },
    [snapshot],
  )

  const onReconnect = useCallback(
    (old: DiagramEdge, c: Connection) => {
      snapshot()
      setEdges((es) =>
        es.map((e) =>
          e.id === old.id
            ? { ...e, source: c.source, target: c.target, sourceHandle: c.sourceHandle, targetHandle: c.targetHandle }
            : e,
        ),
      )
    },
    [snapshot],
  )

  /** After a resize with snapping on: the node's edges move to the nearest grid lines. */
  const resized = useCallback(
    (id: string) => {
      if (!snapToGrid) return
      const node = flow.getNode(id)
      const rect = rectOf(id)
      if (!node || !rect) return
      const parent = node.parentId ? rectOf(node.parentId) : null
      const x = snapValue(rect.x)
      const y = snapValue(rect.y)
      const width = Math.max(GRID, snapValue(rect.x + rect.w) - x)
      const height = Math.max(GRID, snapValue(rect.y + rect.h) - y)
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id
            ? {
                ...n,
                position: { x: x - (parent?.x ?? 0), y: y - (parent?.y ?? 0) },
                width,
                // A block's height follows its text.
                ...(n.type === 'block' ? {} : { height }),
              }
            : n,
        ),
      )
    },
    [flow, rectOf, snapToGrid],
  )

  // ------------------------------------------------------------ editing actions
  const updateNode = useCallback(
    (id: string, patch: Partial<DiagramNodeData>) => {
      snapshot()
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)))
    },
    [snapshot],
  )
  const updateEdge = useCallback(
    (id: string, patch: Partial<ConnectorData>) => {
      snapshot()
      setEdges((es) => es.map((e) => (e.id === id && e.data ? { ...e, data: { ...e.data, ...patch } } : e)))
    },
    [snapshot],
  )
  const updateSelectedNodes = (patch: Partial<DiagramNodeData>) => {
    snapshot()
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { ...n.data, ...patch } } : n)))
  }
  const updateSelectedEdges = (patch: Partial<ConnectorData>) => {
    snapshot()
    setEdges((es) => es.map((e) => (e.selected && e.data ? { ...e, data: { ...e.data, ...patch } } : e)))
  }

  /** Adds nodes (already positioned) as the new selection. */
  const insert = useCallback(
    (newNodes: DiagramNode[], newEdges: DiagramEdge[] = []) => {
      snapshot()
      setNodes((ns) =>
        normalizeOrder([
          ...ns.map((n) => (n.selected ? { ...n, selected: false } : n)),
          ...newNodes.map((n) => ({ ...n, selected: true })),
        ]),
      )
      setEdges((es) => [
        ...es.map((e) => (e.selected ? { ...e, selected: false } : e)),
        ...newEdges.map((e) => ({ ...e, selected: true })),
      ])
    },
    [snapshot],
  )

  const addCount = useRef(0)
  const addItem = useCallback(
    (item: LibraryItem, at?: XYPosition) => {
      let center = at
      if (!center) {
        // Clicked in the panel: the middle of the visible canvas, cascading repeated adds.
        const box = canvas.current?.getBoundingClientRect()
        const step = (addCount.current++ % 6) * PASTE_OFFSET
        center = flow.screenToFlowPosition({
          x: (box ? box.left + box.width / 2 : window.innerWidth / 2) + step,
          y: (box ? box.top + box.height / 2 : window.innerHeight / 2) + step,
        })
      }
      const node = createNode(item, center)
      if (snapToGrid) {
        // Its edges on the grid, not just its center: the default sizes aren't multiples of it.
        node.position = { x: snapValue(node.position.x), y: snapValue(node.position.y) }
        if (node.width) node.width = Math.max(GRID, snapValue(node.width))
        if (node.height) node.height = Math.max(GRID, snapValue(node.height))
      }
      const rect = { ...node.position, w: node.width ?? 0, h: node.height ?? 0 }
      const parent = findContainer(rect, new Set())
      if (parent) {
        node.parentId = parent.id
        node.position = { x: rect.x - parent.rect.x, y: rect.y - parent.rect.y }
      }
      insert([node])
      setRecent((list) => withRecent(list, item))
    },
    [flow, findContainer, insert, snapToGrid, setRecent],
  )

  const onDrop = useCallback(
    (event: DragEvent) => {
      const raw = event.dataTransfer.getData(LIBRARY_DRAG_TYPE)
      if (!raw) return
      event.preventDefault()
      // Checked like anything stored: a drop can come from another page.
      let item: LibraryItem | null = null
      try {
        item = toLibraryItem(JSON.parse(raw))
      } catch {
        item = null
      }
      if (item) addItem(item, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
    },
    [addItem, flow],
  )

  // Copy/paste keeps a container's contents and the connectors between copied shapes.
  const pasteCount = useRef(0)

  const collectSelection = useCallback((): Clip | null => {
    const all = flow.getNodes()
    const ids = withDescendants(
      all.filter((n) => n.selected).map((n) => n.id),
      all,
    )
    if (ids.size === 0) return null
    const nodes = all
      .filter((n) => ids.has(n.id))
      .map((n) => {
        if (!n.parentId || ids.has(n.parentId)) return n
        const r = rectOf(n.id) // parent not copied: detach at its absolute position
        return { ...n, parentId: undefined, position: r ? { x: r.x, y: r.y } : n.position }
      })
    const edges = flow.getEdges().filter((e) => ids.has(e.source) && ids.has(e.target))
    return { nodes, edges }
  }, [flow, rectOf])

  const paste = useCallback(
    (clip: Clip, offset: XYPosition) => {
      const map = new Map(clip.nodes.map((n) => [n.id, crypto.randomUUID()]))
      const newNodes = clip.nodes.map((n) => {
        const parentId = n.parentId ? map.get(n.parentId) : undefined
        return {
          ...n,
          id: map.get(n.id) ?? crypto.randomUUID(),
          parentId,
          // Only top-level pasted nodes move; children stay put inside their pasted parent.
          position: parentId ? n.position : { x: n.position.x + offset.x, y: n.position.y + offset.y },
          data: { ...n.data },
        }
      })
      const newEdges = clip.edges.map((e) => ({
        ...e,
        id: crypto.randomUUID(),
        source: map.get(e.source) ?? e.source,
        target: map.get(e.target) ?? e.target,
        data: e.data ? { ...e.data } : e.data,
      }))
      insert(newNodes, newEdges)
    },
    [insert],
  )

  // The clipboard is the system's, so a copy can be pasted into another diagram (or
  // another tab). What goes on it is the saved format; a paste goes through parse(),
  // like anything loaded, and never trusts the text it finds.
  const editorId = useRef(crypto.randomUUID())

  /** The offset that puts pasted content in the middle of the visible canvas (kept on the grid when snapping). */
  const offsetToView = useCallback(
    (clip: Clip): XYPosition => {
      const top = clip.nodes.filter((n) => !n.parentId)
      const minX = Math.min(...top.map((n) => n.position.x))
      const minY = Math.min(...top.map((n) => n.position.y))
      const maxX = Math.max(...top.map((n) => n.position.x + (n.width ?? 0)))
      const maxY = Math.max(...top.map((n) => n.position.y + (n.height ?? 0)))
      const box = canvas.current?.getBoundingClientRect()
      const center = flow.screenToFlowPosition({
        x: box ? box.left + box.width / 2 : window.innerWidth / 2,
        y: box ? box.top + box.height / 2 : window.innerHeight / 2,
      })
      let dx = center.x - (minX + maxX) / 2
      let dy = center.y - (minY + maxY) / 2
      // Keep things on the grid they came from.
      if (snapToGrid) {
        dx = snapValue(dx)
        dy = snapValue(dy)
      }
      return { x: Math.round(dx), y: Math.round(dy) }
    },
    [flow, snapToGrid],
  )

  // ------------------------------------------------------------ Mermaid import
  // Mermaid code (pasted on the canvas, or from the Import dialog) is laid out by
  // mermaid/layout.ts into the saved format, then goes through parse() and paste() like
  // any clipboard content: one undo step, selected, in the middle of the view.
  const [mermaidOpen, setMermaidOpen] = useState(false)

  const addImported = useCallback(
    (result: ImportedDiagram) => {
      const clip = parse(result.diagram)
      if (clip.nodes.length === 0) return
      if (snapToGrid) {
        for (const n of clip.nodes) {
          n.position = { x: snapValue(n.position.x), y: snapValue(n.position.y) }
          if (n.width) n.width = Math.max(GRID, snapValue(n.width))
          if (n.height) n.height = Math.max(GRID, snapValue(n.height))
        }
      }
      paste(clip, offsetToView(clip))
      // Shown whole once React Flow has measured the new shapes (tables size themselves).
      window.setTimeout(() => {
        void flow.fitView({ nodes: flow.getNodes().filter((n) => n.selected), padding: 0.2, maxZoom: 1, duration: 300 })
      }, 80)
      toast.success(`Imported ${importSummary(result.kind, result.counts)}`, {
        description: result.skipped.length > 0 ? skippedSummary(result.skipped) : 'Undo with ⌘Z if it isn’t what you wanted.',
      })
    },
    [flow, offsetToView, paste, snapToGrid],
  )

  const importPasted = useCallback(
    async (code: string) => {
      let importer: typeof import('./mermaid/layout')
      try {
        importer = await import('./mermaid/layout')
      } catch {
        toast.error('The Mermaid importer couldn’t load. Check your connection and try again.')
        return
      }
      const result = importer.mermaidToDiagram(code)
      if (!result.ok) {
        toast.error('This Mermaid code can’t be imported', { description: result.error })
        return
      }
      addImported(result)
    },
    [addImported],
  )

  /** Content copied in this editor is pasted a step down and right each time; content from elsewhere lands in the middle of the view. */
  const pasteFromClipboard = useCallback(
    (text: string) => {
      if (!text.startsWith(CLIP_MARKER)) {
        // Not ours: Mermaid code (bare, or in a chatbot's ```mermaid reply) becomes shapes.
        const mermaid = findMermaid(text)
        if (!mermaid) return false
        void importPasted(mermaid.code)
        return true
      }
      if (text.length > MAX_CLIP_CHARS) return false
      let payload: unknown
      try {
        payload = JSON.parse(text.slice(CLIP_MARKER.length))
      } catch {
        return false
      }
      if (typeof payload !== 'object' || payload === null) return false
      const clip = parse(payload as Json)
      if (clip.nodes.length === 0) return false
      const from = (payload as { from?: unknown }).from
      if (from === editorId.current) {
        pasteCount.current += 1
        paste(clip, { x: PASTE_OFFSET * pasteCount.current, y: PASTE_OFFSET * pasteCount.current })
        return true
      }
      paste(clip, offsetToView(clip))
      return true
    },
    [offsetToView, paste, importPasted],
  )

  const duplicate = useCallback(() => {
    const clip = collectSelection()
    if (clip) paste(clip, { x: PASTE_OFFSET, y: PASTE_OFFSET })
  }, [collectSelection, paste])

  const deleteSelection = useCallback(() => {
    void flow.deleteElements({
      nodes: flow.getNodes().filter((n) => n.selected),
      edges: flow.getEdges().filter((e) => e.selected),
    })
  }, [flow])

  /** Selected nodes that aren't inside another selected node (those move with their parent). */
  const topSelected = () => {
    const selected = flow.getNodes().filter((n) => n.selected)
    const ids = new Set(selected.map((n) => n.id))
    return selected.filter((n) => !n.parentId || !ids.has(n.parentId))
  }

  /** Moves nodes to new absolute positions (converted back to parent-relative). */
  const moveTo = (positions: Map<string, XYPosition>) => {
    snapshot()
    setNodes((ns) =>
      ns.map((n) => {
        const abs = positions.get(n.id)
        if (!abs) return n
        const parent = n.parentId ? rectOf(n.parentId) : null
        return { ...n, position: { x: abs.x - (parent?.x ?? 0), y: abs.y - (parent?.y ?? 0) } }
      }),
    )
  }

  const align = (alignment: Alignment) => {
    const rects = topSelected().flatMap((n) => {
      const r = rectOf(n.id)
      return r ? [{ id: n.id, ...r }] : []
    })
    if (rects.length < 2) return
    const minX = Math.min(...rects.map((r) => r.x))
    const maxX = Math.max(...rects.map((r) => r.x + r.w))
    const minY = Math.min(...rects.map((r) => r.y))
    const maxY = Math.max(...rects.map((r) => r.y + r.h))
    const positions = new Map<string, XYPosition>()
    for (const r of rects) {
      const x = { left: minX, center: (minX + maxX) / 2 - r.w / 2, right: maxX - r.w }
      const y = { top: minY, middle: (minY + maxY) / 2 - r.h / 2, bottom: maxY - r.h }
      positions.set(r.id, {
        x: alignment in x ? x[alignment as keyof typeof x] : r.x,
        y: alignment in y ? y[alignment as keyof typeof y] : r.y,
      })
    }
    moveTo(positions)
  }

  const distribute = (axis: 'x' | 'y') => {
    const size = axis === 'x' ? 'w' : 'h'
    const rects = topSelected()
      .flatMap((n) => {
        const r = rectOf(n.id)
        return r ? [{ id: n.id, ...r }] : []
      })
      .sort((a, b) => a[axis] - b[axis])
    if (rects.length < 3) return
    const first = rects[0]
    const last = rects[rects.length - 1]
    const total = rects.reduce((sum, r) => sum + r[size], 0)
    const gap = (last[axis] + last[size] - first[axis] - total) / (rects.length - 1)
    const positions = new Map<string, XYPosition>()
    let cursor = first[axis]
    for (const r of rects) {
      positions.set(r.id, axis === 'x' ? { x: cursor, y: r.y } : { x: r.x, y: cursor })
      cursor += r[size] + gap
    }
    moveTo(positions)
  }

  const arrange = (to: 'front' | 'back') => {
    snapshot()
    setNodes((ns) => {
      const selected = ns.filter((n) => n.selected)
      const rest = ns.filter((n) => !n.selected)
      return normalizeOrder(to === 'front' ? [...rest, ...selected] : [...selected, ...rest])
    })
  }

  // ------------------------------------------------------------ keyboard
  const lastNudge = useRef(0)
  useEffect(() => {
    if (readOnly) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="menu"]')) return
      const mod = event.metaKey || event.ctrlKey
      const key = (event.key ?? '').toLowerCase()

      if (mod && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) history.redo()
        else history.undo()
      } else if (mod && key === 'y') {
        event.preventDefault()
        history.redo()
      } else if (mod && key === 'd') {
        event.preventDefault()
        duplicate()
      } else if (mod && key === 'a') {
        event.preventDefault()
        setNodes((ns) => ns.map((n) => ({ ...n, selected: true })))
        setEdges((es) => es.map((e) => ({ ...e, selected: true })))
      } else if ((key === 'enter' || key === 'f2') && !mod) {
        const selected = flow.getNodes().filter((n) => n.selected)
        const selectedEdges = flow.getEdges().filter((e) => e.selected)
        if (selected.length === 1 && selectedEdges.length === 0) {
          event.preventDefault()
          setEditingId(selected[0].id)
        } else if (selectedEdges.length === 1 && selected.length === 0) {
          event.preventDefault()
          setEditingId(selectedEdges[0].id)
        }
      } else if (key.startsWith('arrow') && !mod) {
        const selected = topSelected()
        if (selected.length === 0) return
        event.preventDefault()
        // One undo step per burst of nudges.
        if (event.timeStamp - lastNudge.current > 600) snapshot()
        lastNudge.current = event.timeStamp
        // With snapping on, a nudge is one grid step.
        const step = snapToGrid ? GRID : event.shiftKey ? 10 : 1
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
        const ids = new Set(selected.map((n) => n.id))
        setNodes((ns) =>
          ns.map((n) => (ids.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)),
        )
      } else if (!mod && !event.altKey && (key === 'v' || key === 'p' || key === 'h' || key === 'e')) {
        event.preventDefault()
        setTool(key === 'v' ? 'select' : key === 'p' ? 'pen' : key === 'h' ? 'highlighter' : 'eraser')
      } else if (key === 'escape' && drawing) {
        setTool('select')
      } else if (key === 'escape') {
        setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)))
        setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  // ------------------------------------------------------------ clipboard (copy, cut, paste events)
  useEffect(() => {
    if (readOnly) return
    // Text being typed (a label, the title, a search box) keeps the normal clipboard.
    const typing = (event: Event) =>
      Boolean((event.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable], [role="dialog"]'))
    const write = (event: ClipboardEvent) => {
      if (typing(event) || !event.clipboardData) return false
      const clip = collectSelection()
      if (!clip) return false
      const payload = { from: editorId.current, ...(serialize(clip) as object) }
      event.clipboardData.setData('text/plain', CLIP_MARKER + JSON.stringify(payload))
      event.preventDefault()
      pasteCount.current = 0
      return true
    }
    const onCopy = (event: ClipboardEvent) => void write(event)
    const onCut = (event: ClipboardEvent) => {
      if (write(event)) deleteSelection()
    }
    const onPaste = (event: ClipboardEvent) => {
      if (typing(event) || !event.clipboardData) return
      if (pasteFromClipboard(event.clipboardData.getData('text/plain'))) event.preventDefault()
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }, [readOnly, collectSelection, deleteSelection, pasteFromClipboard])

  // ------------------------------------------------------------ render
  const context = useMemo(
    () => ({ readOnly, editingId, setEditingId, snapshot, updateNode, updateEdge, resized }),
    [readOnly, editingId, snapshot, updateNode, updateEdge, resized],
  )
  const selectedNodes = nodes.filter((n) => n.selected)
  const selectedEdges = edges.filter((e) => e.selected)

  return (
    <DiagramEditorContext.Provider value={context}>
      <div className="flex size-full flex-col">
        <Toolbar
          readOnly={readOnly}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={history.undo}
          onRedo={history.redo}
          fullscreen={fullscreen}
          onFullscreen={onFullscreen}
          propertiesOpen={propertiesOpen}
          onToggleProperties={toggleProperties}
          snapToGrid={snapToGrid}
          onSnapToGrid={setSnapToGrid}
          onImportMermaid={() => setMermaidOpen(true)}
          tool={tool}
          onTool={setTool}
          inkColor={tool === 'highlighter' ? ink.highlighter : ink.pen}
          onInkColor={(color) => setInk(tool === 'highlighter' ? { highlighter: color } : { pen: color })}
          penSize={ink.size}
          onPenSize={(size) => setInk({ size })}
        />
        {!readOnly && <MermaidImportDialog open={mermaidOpen} onOpenChange={setMermaidOpen} onImport={addImported} />}
        <div className="flex min-h-0 flex-1">
          {!readOnly && (
            <ShapePanel
              onAdd={(item) => addItem(item)}
              recent={recent}
              onForget={(item) => setRecent((list) => withoutRecent(list, item))}
            />
          )}
          <div ref={canvas} className="relative min-w-0 flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            <ReactFlow<DiagramNode, DiagramEdge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onReconnect={onReconnect}
              onBeforeDelete={async () => {
                snapshot()
                return true
              }}
              onNodeDragStart={snapshot}
              onSelectionDragStart={snapshot}
              onNodeDragStop={(_event, _node, dragged) => {
                setGuides(null)
                reparent(dragged.map((n) => n.id))
              }}
              onNodeDoubleClick={(_event, node) => !readOnly && setEditingId(node.id)}
              onEdgeDoubleClick={(_event, edge) => !readOnly && setEditingId(edge.id)}
              isValidConnection={(c) => c.source !== c.target}
              // Layers are set on nodes/edges by the model (containers < connectors < shapes).
              zIndexMode="manual"
              elevateNodesOnSelect={false}
              connectionMode={ConnectionMode.Loose}
              connectionLineType={ConnectionLineType.SmoothStep}
              connectionRadius={28}
              // Lucid-style navigation: drag on empty canvas selects, space/middle-drag or scroll pans.
              selectionOnDrag={!readOnly && !drawing}
              selectionMode={SelectionMode.Partial}
              panOnDrag={readOnly ? true : [1, 2]}
              panOnScroll
              zoomOnDoubleClick={false}
              snapToGrid={snapToGrid}
              snapGrid={[GRID, GRID]}
              minZoom={0.1}
              maxZoom={4}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
              nodesDraggable={!readOnly && !drawing}
              nodesConnectable={!readOnly && !drawing}
              elementsSelectable={!readOnly && !drawing}
              edgesReconnectable={!readOnly}
              deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
              multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
              disableKeyboardA11y
              proOptions={{ hideAttribution: true }}
              style={flowStyle}
              className={cn(readOnly && '[&_.react-flow__node]:cursor-default')}
            >
              {snapToGrid ? (
                // Snapping on: the grid is drawn as lines every 64 px, in the theme's hairline
                // color so it stays quiet in light and dark. The 16 px steps it snaps to are an
                // opt-in ("Fine grid lines"), fainter still.
                <>
                  {fineGrid && (
                    <Background
                      id="snap-minor"
                      variant={BackgroundVariant.Lines}
                      gap={GRID}
                      lineWidth={0.5}
                      color="color-mix(in oklab, var(--border) 60%, transparent)"
                    />
                  )}
                  <Background
                    id="snap-major"
                    // Over the fine grid, its fill would hide it.
                    bgColor={fineGrid ? 'transparent' : undefined}
                    variant={BackgroundVariant.Lines}
                    gap={GRID * 4}
                    lineWidth={0.75}
                    color="color-mix(in oklab, var(--border), var(--foreground) 6%)"
                  />
                </>
              ) : (
                <Background variant={BackgroundVariant.Dots} gap={GRID} size={1.2} color="var(--border)" />
              )}
              <GuideLines guides={guides} />
              {!readOnly && drawing && (
                <InkLayer
                  tool={tool}
                  color={tool === 'highlighter' ? ink.highlighter : ink.pen}
                  size={tool === 'highlighter' ? HIGHLIGHTER_SIZE : ink.size}
                  onStroke={addStroke}
                  onEraseStart={snapshot}
                  onErase={eraseStrokes}
                />
              )}
            </ReactFlow>
            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
                {readOnly
                  ? 'This whiteboard is empty.'
                  : drawing
                    ? 'Draw anywhere. Press V or Esc to go back to selecting.'
                    : 'Draw with the pen (P), drag shapes from the left, or paste Mermaid code.'}
              </div>
            )}
          </div>
          {!readOnly && propertiesOpen && (
            <PropertiesPanel
              nodes={selectedNodes}
              edges={selectedEdges}
              onNodes={updateSelectedNodes}
              onEdges={updateSelectedEdges}
              onAlign={align}
              onDistribute={distribute}
              onArrange={arrange}
              onDuplicate={duplicate}
              onDelete={deleteSelection}
              snapToGrid={snapToGrid}
              onSnapToGrid={setSnapToGrid}
              fineGrid={fineGrid}
              onFineGrid={setFineGrid}
            />
          )}
        </div>
      </div>
    </DiagramEditorContext.Provider>
  )
}
