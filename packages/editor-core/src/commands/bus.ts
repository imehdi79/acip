import type { DrawingDocument } from '../document/document.js';
import { TransactionImpl } from '../document/history/transaction.js';
import type { HistoryStack } from '../document/history/history.js';
import type { CommandRegistry } from './command-registry.js';

/**
 * THE single mutation path. dispatch = validate → open tx → execute →
 * commit + history + one batched change event. Any throw → rollback.
 * An AI agent's tool call is literally bus.dispatch(name, json).
 */
export class CommandBus {
  private activeTx: TransactionImpl | null = null;

  constructor(
    private doc: DrawingDocument,
    private registry: CommandRegistry,
    private history: HistoryStack,
  ) {}

  dispatch<R = unknown>(name: string, rawParams: unknown = {}): R {
    const command = this.registry.get(name);
    const params = command.params.validate(rawParams);

    // a command dispatching another command joins the open transaction:
    // composite operations stay one atomic, one-Ctrl+Z unit
    if (this.activeTx) {
      return command.execute({ doc: this.doc, tx: this.activeTx }, params) as R;
    }

    const tx = new TransactionImpl(this.doc);
    this.activeTx = tx;
    try {
      const result = command.execute({ doc: this.doc, tx }, params);
      const record = tx.commit(name, params);
      this.history.push(record);
      this.doc._emitChange('commit', record);
      return result as R;
    } catch (error) {
      tx.rollback();
      throw error;
    } finally {
      this.activeTx = null;
    }
  }
}
