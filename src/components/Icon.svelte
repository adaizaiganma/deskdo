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
    chevron: "M6 3.5 10.5 8 6 12.5",
    chevronLeft: "M10 3.5 5.5 8l4.5 4.5",
    chevronDown: "M3.5 6 8 10.5 12.5 6",
    back: "M13 8H3M7.5 3.5 3 8l4.5 4.5",
    refresh: "M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3",
    // 六齒齒輪
    settings: "M6.01 3.74L6.89 1.70L9.11 1.70L9.99 3.74L10.70 4.15L12.90 3.89L14.01 5.81L12.68 7.59L12.68 8.41L14.01 10.19L12.90 12.11L10.70 11.85L9.99 12.26L9.11 14.30L6.89 14.30L6.01 12.26L5.30 11.85L3.10 12.11L1.99 10.19L3.32 8.41L3.32 7.59L1.99 5.81L3.10 3.89L5.30 4.15zM10.1 8a2.1 2.1 0 1 1-4.2 0 2.1 2.1 0 1 1 4.2 0z",
    inbox: "M2.5 9 4.2 3.8A1 1 0 0 1 5.1 3h5.8a1 1 0 0 1 .9.8L13.5 9v3.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1zM2.5 9h3l1 1.5h3l1-1.5h3",
    search: "M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10.6 10.6 14 14",
    close: "M4 4l8 8M12 4l-8 8",
    check: "M3 8.4l3.2 3.1L13 4.6",
    done: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM5.5 8.2l1.7 1.7 3.3-3.6",
    folder: "M2.5 4.5a1 1 0 0 1 1-1h2.8l1.5 1.5h4.7a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z",
    link: "M6.6 9.4 9.4 6.6M7.2 4.6l.9-.9a2.6 2.6 0 0 1 3.7 3.7l-.9.9M8.8 11.4l-.9.9a2.6 2.6 0 0 1-3.7-3.7l.9-.9",
    next: "M3 8h8.5M8.5 4.5 12 8l-3.5 3.5",
    sparkle: "M8 2.5 9.2 6.8 13.5 8 9.2 9.2 8 13.5 6.8 9.2 2.5 8 6.8 6.8z",
    menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
    home: "M2.5 7.2 8 2.8l5.5 4.4M4 6v6.5a1 1 0 0 0 1 1h2v-3.5h2v3.5h2a1 1 0 0 0 1-1V6",
    clock: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 4.8V8l2.2 1.4",
    hourglass: "M4.5 2.5h7M4.5 13.5h7M5.5 2.5V4c0 1.7 2.5 2.4 2.5 4S5.5 10.3 5.5 12v1.5M10.5 2.5V4c0 1.7-2.5 2.4-2.5 4s2.5 2.3 2.5 4v1.5",
    pin: "M6 2.2h4l-.6 3.8 2.5 2.6H4.1L6.6 6zM8 8.6v5.2",
    grid: "M2.5 2.5h4.5V7H2.5zM9 2.5h4.5V7H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z",
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 16, stroke, fill = false }: { name: IconName; size?: number; stroke?: number; fill?: boolean } = $props();
  // 大圖示的線條在 viewBox 裡細一點，畫出來才是 2px 左右
  const width = $derived(stroke ?? (size >= 20 ? 1.35 : 1.6));
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill={fill ? "currentColor" : "none"}
  stroke="currentColor"
  stroke-width={width}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name]} />
</svg>
