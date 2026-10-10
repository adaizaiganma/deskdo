<script lang="ts" module>
  // 16×16 線條圖示
  const PATHS = {
    plus: "M8 3v10M3 8h10",
    calendar: "M2.5 5.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2zM2.5 6.8h11M5.5 2v3M10.5 2v3",
    hash: "M6 2.5 4.5 13.5M11.5 2.5 10 13.5M2.5 6h11M2 10.5h11",
    flag: "M4 14V2.5M4 3h8l-1.6 3L12 9H4",
    mail: "M3.6 3.5h8.8A1.6 1.6 0 0 1 14 5.1v5.8a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 10.9V5.1a1.6 1.6 0 0 1 1.6-1.6zM2.6 4.6 8 8.6l5.4-4",
    note: "M3.5 4.5h9M3.5 8h9M3.5 11.5h5",
    trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5",
    more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
    chevron: "M6 3.5 10.5 8 6 12.5",
    refresh: "M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3",
    settings: "M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM8 1.8v1.6M8 12.6v1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.6M12.6 8h1.6M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1",
    inbox: "M2.5 9 4.2 3.8A1 1 0 0 1 5.1 3h5.8a1 1 0 0 1 .9.8L13.5 9v3.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1zM2.5 9h3l1 1.5h3l1-1.5h3",
    sun: "M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1",
    upcoming: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 4.8V8l2.2 1.4",
    tray: "M2.5 9.5h3l1 1.5h3l1-1.5h3M2.5 9.5v3a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3",
    done: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM5.5 8.2l1.7 1.7 3.3-3.6",
    search: "M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10.6 10.6 14 14",
    close: "M4 4l8 8M12 4l-8 8",
    minimize: "M3.5 8h9",
    maximize: "M4 4h8v8H4z",
    restore: "M5.5 3.5h7v7M3.5 5.5h7v7h-7z",
    widget: "M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM2.5 5.5h11",
    open: "M9.5 2.5h4v4M13.5 2.5 8 8M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3",
    sparkle: "M8 2.5 9.2 6.8 13.5 8 9.2 9.2 8 13.5 6.8 9.2 2.5 8 6.8 6.8z",
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 16, stroke = 1.6 }: { name: IconName; size?: number; stroke?: number } = $props();
  const wide = $derived(name === "more" ? 2.6 : stroke);
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width={wide}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name]} />
</svg>
