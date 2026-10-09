/**
 * State store. MemoryStore is used by tests and the demo; FileStore persists
 * the same structure to one JSON file so the decision service survives a
 * restart. Swap in a database by implementing the same small surface.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export class MemoryStore {
  constructor(state) {
    this.state = state ?? { leads: {}, dedup: {}, optOuts: {}, calls: {} };
  }

  getLead(id) {
    return this.state.leads[id] ?? null;
  }

  saveLead(lead) {
    this.state.leads[lead.id] = lead;
    this.persist();
  }

  allLeads() {
    return Object.values(this.state.leads);
  }

  leadsByPhone(phone) {
    return this.allLeads().filter((l) => l.phone && l.phone === phone);
  }

  getDedup(key) {
    return this.state.dedup[key] ?? null;
  }

  setDedup(key, value) {
    this.state.dedup[key] = value;
    this.persist();
  }

  isOptedOut(phone) {
    return Boolean(phone && this.state.optOuts[phone]);
  }

  setOptOut(phone, at) {
    this.state.optOuts[phone] = at;
    this.persist();
  }

  clearOptOut(phone) {
    delete this.state.optOuts[phone];
    this.persist();
  }

  linkCall(callId, ref) {
    this.state.calls[callId] = ref;
    this.persist();
  }

  findCall(callId) {
    return this.state.calls[callId] ?? null;
  }

  persist() {}
}

export class FileStore extends MemoryStore {
  constructor(path) {
    super(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined);
    this.path = path;
  }

  persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.path);
  }
}
