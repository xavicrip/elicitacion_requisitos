import type { DetailStatus, DetailType, Priority } from '@reqcanvas/shared';
import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../../lib/model.js';

export type Detail = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  diagramId: Types.ObjectId;
  /** `key` estable de la actividad (003): sobrevive a las versiones del diagrama. */
  activityKey: string;
  given: string;
  when: string;
  then: string;
  type: DetailType;
  priority: Priority | null;
  authorRole: string | null;
  tags: string[];
  status: DetailStatus;
  duplicateOf: Types.ObjectId | null;
  discardReason: string | null;
  /** Desnormalizados con `$inc` (research R4). */
  voteCount: number;
  commentCount: number;
  authorId: Types.ObjectId;
  /** Concurrencia optimista: se exige en `If-Match`. */
  rev: number;
  createdAt: Date;
  updatedAt: Date;
};

const text = (max: number) => ({ type: String, required: true, trim: true, maxlength: max });

const DetailSchema = new Schema<Detail>(
  {
    projectId: { type: Schema.Types.ObjectId, required: true },
    diagramId: { type: Schema.Types.ObjectId, required: true },
    activityKey: { type: String, required: true },
    given: text(1000),
    when: text(1000),
    then: text(1000),
    type: {
      type: String,
      enum: ['functional', 'non_functional', 'business_rule', 'constraint'],
      required: true,
    },
    priority: { type: String, enum: ['must', 'should', 'could', 'wont', null], default: null },
    authorRole: { type: String, default: null, maxlength: 60 },
    tags: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['pending', 'validated', 'duplicate', 'discarded'],
      required: true,
      default: 'pending',
    },
    duplicateOf: { type: Schema.Types.ObjectId, default: null },
    discardReason: { type: String, default: null, maxlength: 500 },
    voteCount: { type: Number, required: true, default: 0, min: 0 },
    commentCount: { type: Number, required: true, default: 0, min: 0 },
    authorId: { type: Schema.Types.ObjectId, required: true },
    rev: { type: Number, required: true, default: 0 },
  },
  SCHEMA_OPTIONS,
);

export const detailsModel = (connection: Connection) =>
  modelFor(connection, 'Detail', DetailSchema, 'details');
