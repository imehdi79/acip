import { RegistryError } from '../common/errors.js';
import type { Command } from './command.js';

export class CommandRegistry {
  private commands = new Map<string, Command<unknown, unknown>>();

  register<P, R>(command: Command<P, R>): void {
    if (this.commands.has(command.name)) {
      throw new RegistryError(`command '${command.name}' already registered`);
    }
    this.commands.set(command.name, command as Command<unknown, unknown>);
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  get(name: string): Command<unknown, unknown> {
    const cmd = this.commands.get(name);
    if (!cmd) throw new RegistryError(`command '${name}' is not registered`);
    return cmd;
  }

  list(): string[] {
    return [...this.commands.keys()];
  }
}
