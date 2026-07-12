import { DrawingDocument } from '../document/document.js';
import { HistoryStack } from '../document/history/history.js';
import type { CommitRecord } from '../document/history/transaction.js';
import { EntityTypeRegistry } from '../registry/entity-registry.js';
import { CommandRegistry } from '../commands/command-registry.js';
import { CommandBus } from '../commands/bus.js';
import { registerBuiltinCommands } from '../commands/builtin.js';
import { registerPrimitiveCommands } from '../commands/primitives.js';
import { registerArchitectureCommands } from '../commands/architecture.js';
import { registerDocumentStoreCommands } from '../commands/document-stores.js';
import { LineEntity, createLineEntity } from '../entities/primitives/line-entity.js';
import { CircleEntity, createCircleEntity } from '../entities/primitives/circle-entity.js';
import { ArcEntity, createArcEntity } from '../entities/primitives/arc-entity.js';
import { PolylineEntity, createPolylineEntity } from '../entities/primitives/polyline-entity.js';
import { WallEntity, createWallEntity } from '../entities/architecture/wall-entity.js';
import { WindowEntity, createWindowEntity } from '../entities/architecture/window-entity.js';
import { DoorEntity, createDoorEntity } from '../entities/architecture/door-entity.js';
import { SelectionSet } from '../selection/index.js';
import { SnapEngine } from '../snapping/index.js';
import { MeasurementService } from '../measurements/index.js';
import type { DocumentData } from '../io/index.js';
import { loadDocumentInto, saveDocument } from '../io/index.js';

export interface EditorSessionOptions {
  doc?: DrawingDocument;
  registerBuiltins?: boolean;
}

/**
 * The facade web-editor instantiates and editor-sdk will re-export.
 * Wires document + registries + history + bus + read services.
 */
export class EditorSession {
  readonly doc: DrawingDocument;
  readonly entityTypes: EntityTypeRegistry;
  readonly commands: CommandRegistry;
  readonly history: HistoryStack;
  readonly bus: CommandBus;
  readonly selection: SelectionSet;
  readonly snap: SnapEngine;
  readonly measure: MeasurementService;

  constructor(options: EditorSessionOptions = {}) {
    this.doc = options.doc ?? new DrawingDocument();
    this.entityTypes = new EntityTypeRegistry();
    this.commands = new CommandRegistry();
    this.history = new HistoryStack(this.doc, this.entityTypes);
    this.bus = new CommandBus(this.doc, this.commands, this.history);
    this.selection = new SelectionSet();
    this.snap = new SnapEngine(this.doc);
    this.measure = new MeasurementService(this.doc);

    if (options.registerBuiltins !== false) {
      this.entityTypes.register({ type: LineEntity.TYPE, create: createLineEntity });
      this.entityTypes.register({ type: CircleEntity.TYPE, create: createCircleEntity });
      this.entityTypes.register({ type: ArcEntity.TYPE, create: createArcEntity });
      this.entityTypes.register({ type: PolylineEntity.TYPE, create: createPolylineEntity });
      this.entityTypes.register({ type: WallEntity.TYPE, create: createWallEntity });
      this.entityTypes.register({ type: WindowEntity.TYPE, create: createWindowEntity });
      this.entityTypes.register({ type: DoorEntity.TYPE, create: createDoorEntity });
      registerBuiltinCommands(this.commands);
      registerPrimitiveCommands(this.commands);
      registerArchitectureCommands(this.commands);
      registerDocumentStoreCommands(this.commands);
    }
  }

  dispatch<R = unknown>(name: string, params?: unknown): R {
    return this.bus.dispatch<R>(name, params);
  }

  undo(): readonly CommitRecord[] | null {
    return this.history.undo();
  }

  redo(): readonly CommitRecord[] | null {
    return this.history.redo();
  }

  save(): DocumentData {
    return saveDocument(this.doc);
  }

  /** replace document content in place — every doc reference stays valid */
  open(data: DocumentData): void {
    this.selection.clear();
    this.history.clear();
    this.doc._reset();
    loadDocumentInto(this.doc, data, this.entityTypes);
    this.doc._emitLoad();
  }

  newDocument(): void {
    this.selection.clear();
    this.history.clear();
    this.doc._reset();
    this.doc._emitLoad();
  }
}
