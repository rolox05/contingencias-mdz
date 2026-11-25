import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Level, NotifyMemory } from '@alerta/core';

export type SubscriptionEvent = 'risk' | 'alerts';

export type DeliveryRecord = {
  at: number;
  type: string;
  ok: boolean;
  status: number | null;
  error?: string;
};

export type Subscription = {
  id: string;
  /** Firma los webhooks (HMAC) y autoriza a administrar la suscripción. */
  secret: string;
  createdAt: number;
  location: { lat: number; lng: number; label: string };
  webhookUrl: string;
  minLevel: Level;
  events: SubscriptionEvent[];
  label: string | null;
  status: 'active' | 'disabled';
  disabledReason: string | null;
  memory: NotifyMemory;
  consecutiveFailures: number;
  lastDelivery: DeliveryRecord | null;
};

export interface SubscriptionStore {
  list(): Promise<Subscription[]>;
  get(id: string): Promise<Subscription | null>;
  put(sub: Subscription): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export class MemoryStore implements SubscriptionStore {
  protected subs = new Map<string, Subscription>();

  async list() {
    return [...this.subs.values()].map((s) => structuredClone(s));
  }

  async get(id: string) {
    const sub = this.subs.get(id);
    return sub ? structuredClone(sub) : null;
  }

  async put(sub: Subscription) {
    this.subs.set(sub.id, structuredClone(sub));
  }

  async delete(id: string) {
    return this.subs.delete(id);
  }
}

/**
 * Guarda las suscripciones en un archivo JSON (escritura atómica). Alcanza para una
 * sola instancia; con varias hace falta una base de datos compartida.
 */
export class FileStore extends MemoryStore {
  private loaded: Promise<void> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {
    super();
  }

  private load() {
    this.loaded ??= readFile(this.path, 'utf8').then(
      (text) => {
        for (const sub of JSON.parse(text) as Subscription[]) this.subs.set(sub.id, sub);
      },
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      },
    );
    return this.loaded;
  }

  private persist() {
    const data = JSON.stringify([...this.subs.values()], null, 2);
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, this.path);
    });
    return this.writing;
  }

  async list() {
    await this.load();
    return super.list();
  }

  async get(id: string) {
    await this.load();
    return super.get(id);
  }

  async put(sub: Subscription) {
    await this.load();
    await super.put(sub);
    await this.persist();
  }

  async delete(id: string) {
    await this.load();
    const deleted = await super.delete(id);
    if (deleted) await this.persist();
    return deleted;
  }
}
