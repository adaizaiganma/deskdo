<script lang="ts">
  import { onDestroy } from "svelte";
  import { Dish, folderRadius, type FolderView, type Layout, type TagView } from "../lib/bubbles";
  import { store } from "../lib/store.svelte";
  import { toast } from "../lib/toast.svelte";
  import type { Folder } from "../lib/types";

  let { onupdatecloud }: { onupdatecloud: () => void } = $props();

  /** 資料夾依順序輪流用這些色相 */
  const PALETTE = [214, 152, 268, 28, 336, 190, 96, 48];
  const LAYOUT_KEY = "bubbles.layout";
  /** 還沒有待辦、也還沒放進資料夾的標籤只存在這台電腦 */
  const EXTRA_KEY = "bubbles.extraTags";
  const LABEL_MAX = 78;

  const folders = $derived(store.folders);
  const locked = $derived(!store.supportsFolders);
  const used = $derived(new Set(store.tags));
  const counts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const t of store.allOpen) if (t.tag) m.set(t.tag, (m.get(t.tag) ?? 0) + 1);
    return m;
  });

  let extras = $state<string[]>(readJson(EXTRA_KEY, []));
  const extraLoose = $derived(extras.filter((t) => !used.has(t) && !store.folderOf.has(t)));

  function readJson<T>(key: string, fallback: T): T {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "") ?? fallback;
    } catch {
      return fallback;
    }
  }
  function writeJson(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }
  function setExtras(next: string[]) {
    extras = [...new Set(next)];
    writeJson(EXTRA_KEY, extras);
  }

  // 量文字寬度，決定小泡泡要多大、標籤名稱要不要截斷
  const ctx = document.createElement("canvas").getContext("2d");
  if (ctx) ctx.font = `600 12px "Noto Sans TC Variable", "Microsoft JhengHei UI", sans-serif`;
  const measure = (s: string) => ctx?.measureText(s).width ?? s.length * 12;
  function labelOf(tag: string) {
    const full = `#${tag}`;
    if (measure(full) <= LABEL_MAX) return full;
    let s = full;
    while (s.length > 2 && measure(s + "…") > LABEL_MAX) s = s.slice(0, -1);
    return s + "…";
  }
  function radiusOf(tag: string) {
    const n = counts.get(tag) ?? 0;
    return Math.max(24, measure(labelOf(tag)) / 2 + 11) + Math.min(10, Math.sqrt(n) * 2.4);
  }

  const specs = $derived(
    folders.map((f, i) => ({ name: f.name, hue: PALETTE[i % PALETTE.length], tags: f.tags.map((tag) => ({ tag, r: radiusOf(tag) })) })),
  );
  const loose = $derived([...store.looseTags, ...extraLoose].map((tag) => ({ tag, r: radiusOf(tag) })));
  const hueOfFolder = $derived(new Map(specs.map((f) => [f.name, f.hue])));

  // 東西太多時整體縮小，全部放得進視窗
  let w = $state(0);
  let h = $state(0);
  const scale = $derived.by(() => {
    if (!w || !h) return 1;
    let area = 0;
    for (const f of specs) area += Math.PI * (folderRadius(f.tags.map((t) => t.r)) + 18) ** 2;
    for (const t of loose) area += Math.PI * (t.r + 16) ** 2;
    return Math.min(1, Math.max(0.4, Math.sqrt((0.42 * w * h) / Math.max(1, area))));
  });
  const W = $derived(w / scale);
  const H = $derived(h / scale);

  const dish = new Dish();
  let view = $state.raw<{ folders: FolderView[]; tags: TagView[]; hover: string | null; drag: string | null }>({
    folders: [],
    tags: [],
    hover: null,
    drag: null,
  });
  let restored = false;
  let raf = 0;

  $effect(() => {
    if (!w || !h) return;
    dish.resize(W, H);
    if (!restored) {
      restored = true;
      dish.restore(readJson<Layout>(LAYOUT_KEY, { folders: {}, tags: {} }));
    }
    dish.sync(specs, loose);
    start();
  });

  function start() {
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function loop() {
    raf = 0;
    const alive = dish.step();
    view = { ...dish.view(), hover: dish.hover, drag: dish.drag?.id ?? null };
    if (alive) start();
    else writeJson(LAYOUT_KEY, dish.save());
  }
  onDestroy(() => {
    cancelAnimationFrame(raf);
    if (restored) writeJson(LAYOUT_KEY, dish.save());
  });

  /** 小泡泡的細胞膜顏色：拖著經過資料夾時先染成那個資料夾的顏色 */
  function hueOf(t: TagView): number | null {
    const f = view.drag === t.id && view.hover ? view.hover : t.folder;
    return f ? (hueOfFolder.get(f) ?? null) : null;
  }

  // ---------- 存檔 ----------

  function save(next: Folder[]) {
    if (locked) {
      toast.error("要先更新雲端才能用資料夾");
      return false;
    }
    store.setFolders(next);
    return true;
  }

  function put(tag: string, name: string) {
    return save(folders.map((f) => ({ ...f, tags: f.name === name ? [...f.tags.filter((t) => t !== tag), tag] : f.tags.filter((t) => t !== tag) })));
  }

  function takeOut(tag: string) {
    // 沒有待辦用的標籤拿出來後，留在這台電腦上，不然泡泡會直接消失
    if (!used.has(tag)) setExtras([...extras, tag]);
    return save(folders.map((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) })));
  }

  function drop(tag: string, target: string | null) {
    const current = store.folderOf.get(tag) ?? null;
    if (target === current) return;
    if (locked) {
      toast.error("要先更新雲端才能用資料夾");
      return;
    }
    dish.moveTag(tag, target);
    if (target) put(tag, target);
    else takeOut(tag);
  }

  function uniqueFolderName() {
    let name = "新資料夾";
    for (let n = 2; folders.some((f) => f.name === name); n++) name = `新資料夾 ${n}`;
    return name;
  }

  function createFolder(x: number, y: number) {
    const name = uniqueFolderName();
    dish.placeAt(`f:${name}`, x, y);
    if (save([...folders, { name, tags: [] }])) renaming = name;
  }

  function createTag(raw: string, at: Adding) {
    const tag = raw.trim().replace(/^[#＃]+/, "").trim();
    if (!tag) return;
    const exists = used.has(tag) || store.folderOf.has(tag) || extraLoose.includes(tag);
    if (exists) {
      // 已經有這個標籤：放到指定的資料夾就好
      if (at.folder && store.folderOf.get(tag) !== at.folder) drop(tag, at.folder);
      else toast.show(`已經有 #${tag} 了`);
      return;
    }
    dish.placeAt(`t:${tag}`, at.wx, at.wy);
    if (at.folder) put(tag, at.folder);
    else setExtras([...extras, tag]);
  }

  function rename(old: string, input: HTMLInputElement) {
    const name = input.value.trim();
    renaming = null;
    if (!name || name === old) return;
    if (folders.some((f) => f.name === name)) return toast.error(`已經有「${name}」資料夾了`);
    dish.rename(old, name);
    save(folders.map((f) => (f.name === old ? { ...f, name } : f)));
  }

  function remove(name: string) {
    const before = folders;
    const b = dish.folders.get(name);
    if (!save(folders.filter((f) => f.name !== name))) return;
    // 沒有待辦用的標籤留下來當未分類的泡泡
    const orphans = before.find((f) => f.name === name)?.tags.filter((t) => !used.has(t)) ?? [];
    if (orphans.length) setExtras([...extras, ...orphans]);
    toast.show(`已刪除「${name}」，裡面的標籤回到未分類`, {
      undo: () => {
        // 復原時泡泡回到原來的位置
        if (b) dish.placeAt(`f:${name}`, b.x, b.y);
        save(before);
      },
    });
  }

  // ---------- 拖曳 ----------

  let host = $state<HTMLDivElement>();
  let press: { kind: "tag" | "folder"; id: string; ox: number; oy: number; sx: number; sy: number; moved: boolean } | null = null;

  function world(e: MouseEvent) {
    const r = host!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale, lx: e.clientX - r.left, ly: e.clientY - r.top };
  }

  /** 指標下面是什麼：資料夾名牌、小泡泡、大泡泡，或空白處 */
  function hit(e: MouseEvent) {
    const p = world(e);
    const pill = (e.target as HTMLElement).closest<HTMLElement>("[data-folder]");
    if (pill) return { p, kind: "folder" as const, id: pill.dataset.folder! };
    const tag = dish.tagAt(p.x, p.y);
    if (tag) return { p, kind: "tag" as const, id: tag };
    const folder = dish.folderAt(p.x, p.y);
    if (folder) return { p, kind: "folder" as const, id: folder };
    return { p, kind: "empty" as const, id: "" };
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest(".menu, input, button")) return;
    menu = null;
    adding = null;
    const { p, kind, id } = hit(e);
    if (kind === "empty") return;
    const b = kind === "tag" ? dish.tags.get(id) : dish.folders.get(id);
    if (!b) return;
    press = { kind, id, ox: b.x - p.x, oy: b.y - p.y, sx: e.clientX, sy: e.clientY, moved: false };
    try {
      host!.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
  }

  function onMove(e: PointerEvent) {
    if (!press) return;
    if (!press.moved) {
      if (Math.hypot(e.clientX - press.sx, e.clientY - press.sy) < 4) return;
      press.moved = true;
      dish.startDrag(press.kind, press.id);
    }
    const p = world(e);
    dish.dragTo(p.x + press.ox, p.y + press.oy, p.x, p.y);
    start();
  }

  function onUp(e: PointerEvent) {
    const pr = press;
    press = null;
    if (!pr) return;
    if (!pr.moved) {
      // 點一下小泡泡：跳出選單，可以直接選要放進哪個資料夾
      if (pr.kind === "tag") openMenu(e, "tag", pr.id);
      return;
    }
    if (pr.kind === "tag") drop(pr.id, dish.hover);
    dish.endDrag();
    start();
  }

  function onCancel() {
    if (press?.moved) dish.endDrag();
    press = null;
    start();
  }

  // ---------- 右鍵選單 ----------

  type MenuKind = "empty" | "folder" | "tag";
  let menu = $state<{ kind: MenuKind; id: string; lx: number; ly: number; wx: number; wy: number } | null>(null);
  type Adding = { lx: number; ly: number; wx: number; wy: number; folder: string | null };
  let adding = $state<Adding | null>(null);
  let renaming = $state<string | null>(null);

  function openMenu(e: MouseEvent, kind: MenuKind, id: string) {
    const p = world(e);
    menu = { kind, id, lx: p.lx, ly: p.ly, wx: p.x, wy: p.y };
  }

  function onContext(e: MouseEvent) {
    e.preventDefault();
    if ((e.target as HTMLElement).closest(".menu, input")) return;
    adding = null;
    const { kind, id } = hit(e);
    openMenu(e, kind, id);
  }

  function startAdding(folder: string | null) {
    if (!menu) return;
    adding = { lx: menu.lx, ly: menu.ly, wx: menu.wx, wy: menu.wy, folder };
    menu = null;
  }

  function act(fn: () => void) {
    fn();
    menu = null;
  }

  /** 選單別超出畫面 */
  function clampMenu(m: { lx: number; ly: number }, items: number) {
    return `left:${Math.max(8, Math.min(m.lx, w - 208))}px; top:${Math.max(8, Math.min(m.ly, h - items * 34 - 20))}px`;
  }

  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      menu = null;
      adding = null;
    }
  }

  const tagFolder = (id: string) => store.folderOf.get(id) ?? null;
  const folderSize = (name: string) => folders.find((f) => f.name === name)?.tags.length ?? 0;
</script>

<svelte:window onkeydown={onKey} />

<div class="page">
  <header>
    <h1>整理標籤</h1>
    <p>把小泡泡（標籤）拖進大泡泡（資料夾），拖出來就移出。右鍵可以新增資料夾或標籤，也可以改名、刪除。</p>
  </header>

  {#if locked}
    <div class="callout">
      <span>資料夾存在你的雲端上，要先更新雲端才能整理。</span>
      <button class="primary" onclick={onupdatecloud}>更新雲端</button>
    </div>
  {/if}

  <div
    class="dish"
    class:dragging={!!view.drag}
    bind:this={host}
    bind:clientWidth={w}
    bind:clientHeight={h}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onCancel}
    oncontextmenu={onContext}
    role="application"
    aria-label="標籤資料夾"
  >
    {#if w && h}
      <svg width={w} height={h} viewBox="0 0 {W} {H}" aria-hidden="true">
        <defs>
          <!--
            形狀：模糊後把透明度拉陡，靠近的圓會像細胞膜一樣黏在一起。
            顏色：另外模糊得更開，取附近各個圓的平均色（feColorMatrix 處理的是還原透明度之後的顏色），
            再填進形狀裡，兩個不同顏色的泡泡黏在一起時，接縫是漸層而不是一刀切。
          -->
          <filter id="goo" filterUnits="userSpaceOnUse" x={-60} y={-60} width={W + 120} height={H + 120} color-interpolation-filters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="soft" />
            <feColorMatrix in="soft" mode="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 22 -9" result="shape" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="28" result="wide" />
            <feColorMatrix in="wide" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 60 0" result="color" />
            <feComposite in="color" in2="shape" operator="in" />
          </filter>
        </defs>

        <g class="rim" filter="url(#goo)">
          {#each view.folders as f (f.id)}
            <circle cx={f.x} cy={f.y} r={f.r + 3} style="--h:{f.hue}" />
          {/each}
          {#each view.tags as t (t.id)}
            {@const hue = hueOf(t)}
            <circle cx={t.x} cy={t.y} r={t.r + 8} class:loose={hue === null} style="--h:{hue ?? 220}" />
          {/each}
        </g>
        <g class="fill" filter="url(#goo)">
          {#each view.folders as f (f.id)}
            <circle cx={f.x} cy={f.y} r={f.r} style="--h:{f.hue}" />
          {/each}
          {#each view.tags as t (t.id)}
            {@const hue = hueOf(t)}
            <circle cx={t.x} cy={t.y} r={t.r + 5} class:loose={hue === null} style="--h:{hue ?? 220}" />
          {/each}
        </g>

        {#each view.folders as f (f.id)}
          {#if !folderSize(f.id)}
            <text class="empty-hint" x={f.x} y={f.y + 4} style="--h:{f.hue}">拖標籤進來</text>
          {/if}
        {/each}

        {#each view.tags as t (t.id)}
          {@const hue = hueOf(t)}
          {@const n = counts.get(t.id) ?? 0}
          <g
            class="tag"
            class:loose={hue === null}
            class:lifted={view.drag === t.id}
            class:unused={!n}
            transform="translate({t.x} {t.y})"
            style="--h:{hue ?? 220}"
          >
            <title>#{t.id}{n ? `：${n} 項待辦` : "：目前沒有待辦"}</title>
            <circle r={t.r} />
            <text y={n ? -1 : 4}>{labelOf(t.id)}</text>
            {#if n}<text class="n" y={13}>{n}</text>{/if}
          </g>
        {/each}
      </svg>

      {#each view.folders as f (f.id)}
        <div
          class="pill"
          class:hot={view.hover === f.id}
          data-folder={f.id}
          style="left:{f.x * scale}px; top:{(f.y - f.r) * scale}px; --h:{f.hue}"
          ondblclick={() => (renaming = f.id)}
          role="presentation"
        >
          {#if renaming === f.id}
            <input
              value={f.id}
              maxlength="40"
              aria-label="資料夾名稱"
              use:focusSelect
              onblur={(e) => rename(f.id, e.currentTarget)}
              onkeydown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.stopPropagation();
                  renaming = null;
                }
              }}
            />
          {:else}
            <span class="clip">{f.id}</span>{#if folderSize(f.id)}<span class="n">{folderSize(f.id)}</span>{/if}
          {/if}
        </div>
      {/each}

      {#if !view.folders.length && !view.tags.length}
        <div class="blank">
          還沒有標籤<br />
          <span>按右鍵新增資料夾或標籤，或在新增待辦時用 #標籤</span>
        </div>
      {/if}

      {#if adding}
        {@const at = adding}
        <form
          class="adding"
          style="left:{Math.max(8, Math.min(at.lx - 90, w - 188))}px; top:{Math.max(8, Math.min(at.ly - 18, h - 48))}px"
          onsubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.querySelector("input")!;
            createTag(input.value, at);
            adding = null;
          }}
        >
          <input
            placeholder={at.folder ? `放進「${at.folder}」的標籤` : "新標籤名稱"}
            maxlength="40"
            aria-label="新標籤名稱"
            use:focusSelect
            onblur={() => (adding = null)}
          />
        </form>
      {/if}

      {#if menu}
        {@const m = menu}
        {#if m.kind === "empty"}
          <div class="menu" style={clampMenu(m, 2)} role="menu">
            <button role="menuitem" onclick={() => act(() => createFolder(m.wx, m.wy))}>新增資料夾（大泡泡）</button>
            <button role="menuitem" onclick={() => startAdding(null)}>新增標籤（小泡泡）</button>
          </div>
        {:else if m.kind === "folder"}
          <div class="menu" style={clampMenu(m, 4)} role="menu">
            <div class="mhead clip">{m.id}</div>
            <button role="menuitem" onclick={() => startAdding(m.id)}>在這裡新增標籤</button>
            <button role="menuitem" onclick={() => act(() => (renaming = m.id))}>重新命名</button>
            <button role="menuitem" class="danger" onclick={() => act(() => remove(m.id))}>刪除資料夾</button>
          </div>
        {:else}
          {@const cur = tagFolder(m.id)}
          <div class="menu" style={clampMenu(m, folders.length + 2)} role="menu">
            <div class="mhead clip">#{m.id}</div>
            {#each folders as f (f.name)}
              <button role="menuitem" disabled={cur === f.name} onclick={() => act(() => drop(m.id, f.name))}>
                <span class="clip">放進「{f.name}」</span>{#if cur === f.name}<span class="check">✓</span>{/if}
              </button>
            {/each}
            {#if cur}
              <button role="menuitem" onclick={() => act(() => drop(m.id, null))}>移出資料夾</button>
            {:else if extraLoose.includes(m.id)}
              <button role="menuitem" class="danger" onclick={() => act(() => setExtras(extras.filter((t) => t !== m.id)))}>移除這個標籤</button>
            {:else if !folders.length}
              <p class="mnote">先按右鍵新增一個資料夾</p>
            {/if}
          </div>
        {/if}
      {/if}
    {/if}
  </div>
</div>

<style>
  .page {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  header {
    padding: 28px 38px 6px;
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
  }
  header p {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--sub);
  }
  .callout {
    margin: 10px 38px 0;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border: 1px solid var(--accent);
    border-radius: 10px;
    font-size: 13px;
  }
  .dish {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    user-select: none;
    touch-action: none;
  }
  .dish.dragging {
    cursor: grabbing;
  }
  svg {
    position: absolute;
    inset: 0;
    display: block;
  }

  /* 細胞膜：外圈深一點、裡面淺一點 */
  .rim circle {
    fill: hsl(var(--h) 62% 80%);
  }
  .fill circle {
    fill: hsl(var(--h) 85% 95%);
  }
  .rim circle.loose {
    fill: hsl(220 10% 82%);
  }
  .fill circle.loose {
    fill: hsl(220 16% 94%);
  }

  .tag {
    cursor: grab;
  }
  .tag circle {
    fill: var(--raised);
    stroke: hsl(var(--h) 55% 72%);
    stroke-width: 1.2;
  }
  .tag.loose circle {
    stroke: var(--ring);
  }
  .tag.lifted {
    filter: drop-shadow(0 4px 8px rgba(16, 24, 40, 0.22));
  }
  .tag.lifted circle {
    stroke: var(--accent);
    stroke-width: 2;
  }
  .tag.unused text {
    fill: var(--faint);
  }
  text {
    font-family: var(--font);
    text-anchor: middle;
    pointer-events: none;
  }
  .tag text {
    font-size: 12px;
    font-weight: 600;
    fill: var(--text);
  }
  .tag text.n {
    font-size: 10.5px;
    font-weight: 400;
    fill: var(--faint);
  }
  .empty-hint {
    font-size: 12px;
    fill: hsl(var(--h, 220) 30% 55%);
  }

  .pill {
    position: absolute;
    transform: translate(-50%, -50%);
    max-width: 190px;
    height: 26px;
    padding: 0 11px;
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 999px;
    background: var(--raised);
    border: 1px solid hsl(var(--h) 55% 72%);
    color: hsl(var(--h) 60% 34%);
    font-size: 12.5px;
    font-weight: 700;
    white-space: nowrap;
    cursor: grab;
    box-shadow: var(--card-shadow);
    transition: transform 0.15s;
  }
  .pill.hot {
    transform: translate(-50%, -50%) scale(1.08);
  }
  .pill .n {
    flex: none;
    font-size: 11px;
    font-weight: 400;
    color: var(--faint);
  }
  .pill input {
    width: 130px;
    height: 22px;
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    color: var(--text);
  }

  .blank {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    text-align: center;
    color: var(--sub);
    font-size: 14px;
    line-height: 1.8;
    pointer-events: none;
  }
  .blank span {
    font-size: 12.5px;
    color: var(--faint);
  }

  .menu {
    position: absolute;
    z-index: 5;
    width: 200px;
    padding: 5px;
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: var(--pop-shadow);
  }
  .menu button {
    width: 100%;
    height: 32px;
    padding: 0 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 6px;
    font-size: 13px;
    text-align: left;
    color: var(--text);
  }
  .menu button:hover:not(:disabled) {
    background: var(--hover);
  }
  .menu button:disabled {
    color: var(--faint);
    cursor: default;
  }
  .menu .danger {
    color: var(--warn);
  }
  .check {
    margin-left: auto;
    color: var(--accent);
  }
  .mhead {
    padding: 6px 10px 4px;
    font-size: 11.5px;
    font-weight: 700;
    color: var(--faint);
    white-space: nowrap;
  }
  .mnote {
    margin: 4px 10px 6px;
    font-size: 12px;
    color: var(--faint);
  }

  .adding {
    position: absolute;
    z-index: 5;
  }
  .adding input {
    width: 180px;
    height: 34px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--accent);
    background: var(--raised);
    box-shadow: var(--pop-shadow);
    outline: none;
    font-size: 13px;
  }

  @media (prefers-color-scheme: dark) {
    .rim circle {
      fill: hsl(var(--h) 38% 40%);
    }
    .fill circle {
      fill: hsl(var(--h) 30% 23%);
    }
    .rim circle.loose {
      fill: hsl(220 8% 38%);
    }
    .fill circle.loose {
      fill: hsl(220 8% 25%);
    }
    .tag circle {
      stroke: hsl(var(--h) 45% 55%);
    }
    .pill {
      border-color: hsl(var(--h) 45% 50%);
      color: hsl(var(--h) 75% 80%);
    }
    .empty-hint {
      fill: hsl(var(--h, 220) 25% 60%);
    }
  }
</style>
