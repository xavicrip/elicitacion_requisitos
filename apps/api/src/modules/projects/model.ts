import type { ProjectStatus, Role } from '@reqcanvas/shared';
import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../lib/model.js';

export type Member = { userId: Types.ObjectId; role: Role; joinedAt: Date };

/** Estado consultable del job de borrado (constitución VI, plan ajuste 9). */
export type DeletionState = {
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  error?: string;
};

export type Project = {
  _id: Types.ObjectId;
  name: string;
  description: string;
  /** `deleting` es interno: el proyecto responde 404 y lo borra el job `project-deletion`. */
  status: ProjectStatus | 'deleting';
  ownerId: Types.ObjectId;
  /** ≥ 1 `admin`; `userId` único dentro del array (research R6). */
  members: Member[];
  lastActivityAt: Date;
  deletion?: DeletionState;
  createdAt: Date;
  updatedAt: Date;
};

const MemberSchema = new Schema<Member>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ['admin', 'participant'], required: true },
    joinedAt: { type: Date, required: true },
  },
  { _id: false },
);

const DeletionSchema = new Schema<DeletionState>(
  {
    status: { type: String, enum: ['pending', 'running', 'done', 'failed'], required: true },
    attempts: { type: Number, required: true, default: 0 },
    error: String,
  },
  { _id: false },
);

const ProjectSchema = new Schema<Project>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: '', maxlength: 2000 },
    status: {
      type: String,
      enum: ['draft', 'open', 'closed', 'deleting'],
      required: true,
      default: 'draft',
    },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    members: { type: [MemberSchema], required: true },
    lastActivityAt: { type: Date, required: true, default: () => new Date() },
    deletion: DeletionSchema,
  },
  SCHEMA_OPTIONS,
);

export const projectsModel = (connection: Connection) =>
  modelFor(connection, 'Project', ProjectSchema, 'projects');
