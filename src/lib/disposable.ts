export class DisposableArray<T extends Disposable> extends Array<T> {
  [Symbol.dispose]() {
    for (const item of this) {
      item[Symbol.dispose]();
    }
  }
}
