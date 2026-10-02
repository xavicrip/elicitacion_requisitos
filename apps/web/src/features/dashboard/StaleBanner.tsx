/** Aviso de que el análisis ya no refleja los datos actuales (FR-014). */
export function StaleBanner({
  newDetails,
  disabled,
  onRun,
}: {
  newDetails: number;
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-600 bg-amber-50 p-3 text-sm"
    >
      <p>
        <span aria-hidden="true">⚠ </span>
        Análisis desactualizado:{' '}
        {newDetails === 1
          ? '1 detalle nuevo o modificado'
          : `${newDetails} detalles nuevos o modificados`}{' '}
        desde que se calculó.
      </p>
      <button
        type="button"
        onClick={onRun}
        disabled={disabled}
        className="rounded border border-amber-700 px-3 py-1 disabled:opacity-50"
      >
        Volver a analizar
      </button>
    </div>
  );
}
