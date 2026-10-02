import type { BBox, ConfidenceLevel, ProposalFlag, ProposalStatus } from '@reqcanvas/shared';
import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../../lib/model.js';

/** Zona propuesta por la detección (data-model.md); solo es actividad al aceptarla. */
export type ActivityProposalDoc = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  jobId: Types.ObjectId;
  versionId: Types.ObjectId;
  /** Identificador dentro del resultado del worker (para enlazar las transiciones). */
  tempId: string;
  bbox: BBox;
  type: 'action' | 'decision' | 'start' | 'end';
  label: string;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  flags: ProposalFlag[];
  status: ProposalStatus;
  activityId: Types.ObjectId | null;
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const ProposalSchema = new Schema<ActivityProposalDoc>(
  {
    projectId: { type: Schema.Types.ObjectId, required: true },
    jobId: { type: Schema.Types.ObjectId, required: true },
    versionId: { type: Schema.Types.ObjectId, required: true },
    tempId: { type: String, required: true },
    bbox: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
      w: { type: Number, required: true },
      h: { type: Number, required: true },
    },
    type: { type: String, enum: ['action', 'decision', 'start', 'end'], required: true },
    label: { type: String, default: '', maxlength: 300 },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    confidenceLevel: { type: String, enum: ['high', 'medium', 'low'], required: true },
    flags: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'discarded', 'superseded'],
      required: true,
      default: 'pending',
    },
    activityId: { type: Schema.Types.ObjectId, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, default: null },
    reviewedAt: { type: Date, default: null },
  },
  SCHEMA_OPTIONS,
);

export const activityProposalsModel = (connection: Connection) =>
  modelFor(connection, 'ActivityProposal', ProposalSchema, 'activity_proposals');
