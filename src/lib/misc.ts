export function addMaxListeners(emitter: NodeJS.EventEmitter, maxListeners: number) {
  emitter.setMaxListeners(emitter.getMaxListeners() + maxListeners);
}
