import type { AnalysisRun, DashboardFilters } from '@reqcanvas/shared';
import { useMemo } from 'react';
import { FormError } from '../../../components/form';
import { AssociationRules } from '../patterns/AssociationRules';
import { HotColdActivities } from '../patterns/HotColdActivities';
import { Sentiment } from '../patterns/Sentiment';
import { DuplicatePairs } from '../quality/DuplicatePairs';
import { QualityList } from '../quality/QualityList';
import { TermsSettings } from '../quality/TermsSettings';
import { StaleBanner } from '../StaleBanner';
import { Clusters } from '../text/Clusters';
import { CooccurrenceGraph } from '../text/CooccurrenceGraph';
import { Keywords } from '../text/Keywords';
import { lookupOf } from '../text/lookup';
import { Topics } from '../text/Topics';
import { WordCloud } from '../text/WordCloud';
import { describeFilters, STAGE_LABEL } from './labels';
import { Tabs, type Tab } from './Tabs';
import { useAnalysisRun } from './useAnalysisRun';

const dateTime = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });
const percent = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 0 });

function Progress({ run }: { run: AnalysisRun | undefined }) {
  const progress = run?.progress;
  return (
    <p role="status" className="text-sm">
      {progress
        ? `Analizando: ${STAGE_LABEL[progress.stage]} (${progress.pct} %)`
        : 'Análisis en cola…'}
    </p>
  );
}

function tabsOf(run: AnalysisRun): Tab[] {
  const results = run.results;
  if (!results) return [];
  const lookup = lookupOf(run);
  const tabs: Tab[] = [];
  if (results.keywords?.byActivity) {
    tabs.push({
      id: 'keywords',
      label: 'Palabras clave',
      content: <Keywords byActivity={results.keywords.byActivity} lookup={lookup} />,
    });
  }
  if (results.keywords?.wordCloud) {
    tabs.push({
      id: 'cloud',
      label: 'Nube de palabras',
      content: <WordCloud terms={results.keywords.wordCloud} />,
    });
  }
  if (results.cooccurrence) {
    tabs.push({
      id: 'cooccurrence',
      label: 'Términos relacionados',
      content: <CooccurrenceGraph network={results.cooccurrence} />,
    });
  }
  if (results.topics) {
    tabs.push({
      id: 'topics',
      label: 'Temas',
      content: <Topics topics={results.topics} lookup={lookup} />,
    });
  }
  if (results.clusters) {
    tabs.push({
      id: 'clusters',
      label: 'Grupos',
      content: <Clusters clusters={results.clusters} lookup={lookup} />,
    });
  }
  if (results.quality) {
    tabs.push({
      id: 'quality',
      label: 'Calidad',
      content: (
        <div className="space-y-3">
          <TermsSettings projectId={run.projectId} />
          <QualityList quality={results.quality} lookup={lookup} />
        </div>
      ),
    });
  }
  if (results.duplicates) {
    tabs.push({
      id: 'duplicates',
      label: `Duplicados (${results.duplicates.length})`,
      content: <DuplicatePairs pairs={results.duplicates} lookup={lookup} />,
    });
  }
  if (results.sentiment) {
    tabs.push({
      id: 'sentiment',
      label: 'Sentimiento',
      content: <Sentiment sentiment={results.sentiment} lookup={lookup} />,
    });
  }
  if (results.association) {
    tabs.push({
      id: 'association',
      label: 'Patrones',
      content: <AssociationRules rules={results.association} />,
    });
  }
  if (results.hotcold) {
    tabs.push({
      id: 'hotcold',
      label: 'Actividades críticas',
      content: <HotColdActivities heat={results.hotcold} lookup={lookup} />,
    });
  }
  return tabs;
}

/**
 * Análisis de texto del dashboard (US2): se lanza en segundo plano con los filtros actuales, se
 * ve el progreso por etapa y el resultado queda guardado con su fecha.
 */
export function AnalysisSection({
  projectId,
  filters,
}: {
  projectId: string;
  filters: DashboardFilters;
}) {
  const analysis = useAnalysisRun(projectId, true);
  const run = analysis.latest;
  const tabs = useMemo(() => (run ? tabsOf(run) : []), [run]);
  const stages = Object.values(run?.stages ?? {});
  const insufficient = stages.some((stage) => stage.reason === 'INSUFFICIENT_DATA');
  const failedStages = Object.entries(run?.stages ?? {})
    .filter(([, stage]) => stage.status === 'failed')
    .map(([name]) => STAGE_LABEL[name as keyof typeof STAGE_LABEL]);
  const unrecognized = run?.results?.preprocess?.unrecognizedRatio ?? 0;
  const failed = analysis.current?.status === 'failed' ? analysis.current : undefined;

  return (
    <section aria-label="Análisis de texto" className="space-y-3 rounded border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Análisis de texto</h2>
        <button
          type="button"
          onClick={() => analysis.start(filters)}
          disabled={analysis.running}
          className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Ejecutar análisis
        </button>
      </div>
      {analysis.running && <Progress run={analysis.current} />}
      <FormError>{analysis.error || failed?.error?.message || ''}</FormError>
      {analysis.loading && <p>Cargando el último análisis…</p>}
      {!analysis.loading && !run && !analysis.running && (
        <p>Aún no se ha ejecutado ningún análisis de este proyecto.</p>
      )}
      {run && (
        <>
          <p className="text-sm text-gray-600">
            Último análisis: {dateTime.format(new Date(run.finishedAt ?? run.createdAt))} ·{' '}
            {run.detailCount ?? 0} detalles · Calculado con {describeFilters(run.filters)}.
          </p>
          {run.stale && (
            <StaleBanner
              newDetails={run.newDetailsSinceRun}
              disabled={analysis.running}
              onRun={() => analysis.start(filters)}
            />
          )}
          {insufficient && (
            <p role="note" className="rounded bg-gray-50 p-3 text-sm">
              Datos insuficientes: con menos de 20 detalles solo se calculan las palabras clave. Los
              temas y los grupos necesitan más aportes.
            </p>
          )}
          {failedStages.length > 0 && (
            <p role="note" className="rounded bg-gray-50 p-3 text-sm">
              No se pudo calcular: {failedStages.join(', ')}. El resto del análisis está completo.
            </p>
          )}
          {unrecognized > 0.2 && (
            <p role="note" className="rounded bg-gray-50 p-3 text-sm">
              El {percent.format(unrecognized)} del texto no se reconoció como español: los
              resultados pueden ser menos fiables.
            </p>
          )}
          <Tabs label="Resultados del análisis" tabs={tabs} />
        </>
      )}
    </section>
  );
}
