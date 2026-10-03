import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../../lib/model.js';

/** Ajustes del análisis de un proyecto (data-model.md): términos propios y programación. */
export type AnalysisSettingsDoc = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  extraAmbiguousTerms: string[];
  extraStopwords: string[];
  schedule: { enabled: boolean; cron: string; timezone: string };
};

/**
 * Programación por defecto: desactivada. Cada proyecto la activa si la quiere (un análisis
 * nocturno automático tendría coste de LLM con los insights activos).
 */
export const DEFAULT_SCHEDULE = {
  enabled: false,
  cron: '0 3 * * *',
  timezone: 'America/Guayaquil',
};

const SettingsSchema = new Schema<AnalysisSettingsDoc>(
  {
    projectId: { type: Schema.Types.ObjectId, required: true },
    extraAmbiguousTerms: { type: [String], default: [] },
    extraStopwords: { type: [String], default: [] },
    schedule: {
      enabled: { type: Boolean, default: DEFAULT_SCHEDULE.enabled },
      cron: { type: String, default: DEFAULT_SCHEDULE.cron },
      timezone: { type: String, default: DEFAULT_SCHEDULE.timezone },
    },
  },
  SCHEMA_OPTIONS,
);

export const analysisSettingsModel = (connection: Connection) =>
  modelFor(connection, 'AnalysisSettings', SettingsSchema, 'analysis_settings');
