# Contrato de interacción: espacio de trabajo (canvas)

Este contrato fija el comportamiento que las features 004–006 extienden sin romperlo.

## Modos

| Modo | Quién | Disponible si |
|------|-------|---------------|
| `view` | Todos los miembros | Siempre |
| `edit` | Administrador | Versión `draft`, viewport ≥ 768 px, flag `diagram-editor` |

## Controles

| Acción | Ratón / táctil | Teclado |
|--------|----------------|---------|
| Zoom (10 %–800 % del ajuste) | Rueda (centrado en el cursor) / pellizco | `+` / `-` |
| Desplazar | Arrastrar el fondo / un dedo | Flechas |
| Ajustar a pantalla | Botón "Ajustar" | `0` |
| Centrar en un punto | Clic en el minimapa | — |
| Resaltar actividad | Pasar el cursor | Foco en la lista accesible |
| Seleccionar actividad | Clic / toque (zona más pequeña si se superponen) | `Tab` + `Enter` |
| Deseleccionar | Clic en el fondo | `Esc` |
| (edit) Crear zona | Arrastrar sobre un área vacía | — |
| (edit) Mover / redimensionar | Arrastrar la zona / los *handles* | Flechas (1 px), `Shift` + flechas (10 px) |
| (edit) Eliminar | Botón en el formulario | `Supr` |

## Estado expuesto (store `workspace/store.ts`)

```ts
type WorkspaceState = {
  versionId: string;
  mode: 'view' | 'edit';
  selectedActivityKey: string | null;
  hoveredActivityKey: string | null;
  camera: { zoom: number; center: { x: number; y: number } }; // coordenadas de imagen (px)
  overlays: Record<string, boolean>; // p. ej. 'heatmap' (004), 'presence' (005), 'proposals' (006)
};
```

## Puntos de extensión

- `<ActivityHotspots renderBadge={(activity) => ReactNode} colorFor={(activity) => Color} />`
  (la 004 añade contadores y el mapa de calor).
- `<WorkspacePage sidePanel={(selectedKey) => ReactNode} />` (la 004 monta el panel de requisitos).
- `useWorkspaceEvents()`: emite `activity:selected`, `camera:changed` (la 005 lo usa para
  presencia y cursores).
- `screenToImage` / `imageToScreen` en `camera/zoom.ts`: conversión de coordenadas reutilizable.
