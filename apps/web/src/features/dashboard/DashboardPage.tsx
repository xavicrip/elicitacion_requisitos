import type { DashboardFilters } from '@reqcanvas/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { FormError } from '../../components/form';
import { ApiError } from '../../lib/api-client';
import { projectKeys, projectsApi } from '../projects/api';
import { ProjectNotFound } from '../projects/ProjectNotFound';
import { AnalysisSection } from './analysis/AnalysisSection';
import { dashboardApi, dashboardKeys, DEFAULT_FILTERS } from './api';
import { CoverageMap } from './descriptive/CoverageMap';
import { Distributions } from './descriptive/Distributions';
import { KpiTiles } from './descriptive/KpiTiles';
import { Timeline } from './descriptive/Timeline';
import { FiltersBar } from './FiltersBar';

/**
 * Dashboard del levantamiento (feature 007, US1): indicadores, distribuciones, serie temporal y
 * mapa de cobertura, con filtros. Solo para Administradores; la API lo rechaza igualmente (403).
 */
export default function DashboardPage() {
  const { projectId = '' } = useParams();
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const project = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  });
  const isAdmin = project.data?.myRole === 'admin';
  const descriptive = useQuery({
    queryKey: dashboardKeys.descriptive(projectId, filters),
    queryFn: () => dashboardApi.descriptive(projectId, filters),
    enabled: isAdmin,
    placeholderData: keepPreviousData,
  });

  if (project.error instanceof ApiError && project.error.status === 404) {
    return <ProjectNotFound />;
  }
  if (project.isLoading) return <p>Cargando…</p>;
  if (!project.data) return <FormError>No se pudo cargar el proyecto.</FormError>;
  if (!isAdmin) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Acceso denegado</h1>
        <p>Solo los Administradores del proyecto pueden ver el dashboard.</p>
        <Link to={`/proyectos/${projectId}`} className="text-blue-700 underline">
          Volver al proyecto
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header>
        <p className="text-sm text-gray-600">
          <Link to={`/proyectos/${projectId}`} className="underline">
            {project.data.name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
      </header>
      <FiltersBar projectId={projectId} filters={filters} onChange={setFilters} />
      {descriptive.error && <FormError>No se pudieron cargar los indicadores.</FormError>}
      {descriptive.isLoading && <p>Calculando indicadores…</p>}
      {descriptive.data && (
        <>
          <KpiTiles kpis={descriptive.data.kpis} />
          <CoverageMap projectId={projectId} byActivity={descriptive.data.byActivity} />
          <Timeline timeline={descriptive.data.timeline} />
          <Distributions data={descriptive.data} />
        </>
      )}
      <AnalysisSection projectId={projectId} filters={filters} />
    </section>
  );
}
