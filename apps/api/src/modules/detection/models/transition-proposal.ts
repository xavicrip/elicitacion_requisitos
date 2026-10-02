import type { ProposalStatus } from '@reqcanvas/shared';
import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../../lib/model.js';

/** Flecha propuesta entre dos propuestas de actividad (data-model.md). */
export type TransitionProposalDoc = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  jobId: Types.ObjectId;
  versionId: Types.ObjectId;
  fromProposalId: Types.ObjectId;
  toProposalId: Types.ObjectId;
  confidence: number;
  status: ProposalStatus;
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const TransitionSchema = new Schema<TransitionProposalDoc>(
  {
    projectId: { type: Schema.Types.ObjectId, required: true },
    jobId: { type: Schema.Types.ObjectId, required: true },
    versionId: { type: Schema.Types.ObjectId, required: true },
    fromProposalId: { type: Schema.Types.ObjectId, required: true },
    toProposalId: { type: Schema.Types.ObjectId, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'discarded', 'superseded'],
      required: true,
      default: 'pending',
    },
    reviewedBy: { type: Schema.Types.ObjectId, default: null },
    reviewedAt: { type: Date, default: null },
  },
  SCHEMA_OPTIONS,
);

export const transitionProposalsModel = (connection: Connection) =>
  modelFor(connection, 'TransitionProposal', TransitionSchema, 'transition_proposals');
