export interface ToastItem {
  id: number;
  message: string;
  kind: "info" | "error";
  undo?: () => void;
}

class Toast {
  current = $state<ToastItem | null>(null);
  #timer: ReturnType<typeof setTimeout> | undefined;
  #seq = 0;

  show(message: string, opts: { undo?: () => void; kind?: "info" | "error"; ms?: number } = {}) {
    clearTimeout(this.#timer);
    this.current = { id: ++this.#seq, message, kind: opts.kind ?? "info", undo: opts.undo };
    this.#timer = setTimeout(() => this.dismiss(), opts.ms ?? 4500);
  }

  error(message: string) {
    this.show(message, { kind: "error", ms: 6000 });
  }

  runUndo() {
    const undo = this.current?.undo;
    this.dismiss();
    undo?.();
  }

  dismiss() {
    clearTimeout(this.#timer);
    this.current = null;
  }
}

export const toast = new Toast();
