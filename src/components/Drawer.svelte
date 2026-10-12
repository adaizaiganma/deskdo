<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import { store } from "@deskdo/core/store.svelte";
  import { closeOnBack } from "../lib/back.svelte";
  import SyncStatus from "../windows/SyncStatus.svelte";
  import Icon from "./Icon.svelte";

  /** 從左邊滑出的抽屜：標籤資料夾、標籤、設定 */
  interface Props {
    open: boolean;
    /** 目前打開的子頁面，例如 tag:電子學、folder:study、settings */
    current: string | null;
    onclose: () => void;
    ongo: (page: string) => void;
  }
  let { open, current, onclose, ongo }: Props = $props();

  closeOnBack("drawer", () => open, () => onclose());

  // 標籤、資料夾頁也列出還沒輪到的步驟，數字也算進去
  const countOf = (tag: string) => store.allOpen.filter((t) => t.tag === tag).length;
  const folders = $derived(
    store.folders.map((f) => {
      const tags = f.tags.map((tag) => ({ tag, count: countOf(tag) }));
      return { name: f.name, tags, count: tags.reduce((n, t) => n + t.count, 0) };
    }),
  );
  const loose = $derived(store.looseTags.map((tag) => ({ tag, count: countOf(tag) })));

  /** 收合的資料夾（每台裝置各自記住） */
  let collapsed = $state<string[]>(readCollapsed());
  function readCollapsed(): string[] {
    try {
      return JSON.parse(localStorage.getItem("main.collapsedFolders") ?? "[]");
    } catch {
      return [];
    }
  }
  function toggleFolder(name: string) {
    collapsed = collapsed.includes(name) ? collapsed.filter((n) => n !== name) : [...collapsed, name];
    try {
      localStorage.setItem("main.collapsedFolders", JSON.stringify(collapsed));
    } catch {}
  }
</script>

{#if open}
  <div class="layer">
    <button class="scrim" onclick={onclose} aria-label="關閉選單" transition:fade={{ duration: 200 }}></button>
    <nav class="drawer" aria-label="標籤" transition:fly={{ x: -320, duration: 240, opacity: 1 }}>
      <div class="brand">
        <span class="name">Deskdo{#if store.prefs?.beta}<span class="beta">Beta</span>{/if}</span>
        <SyncStatus />
      </div>

      <div class="section">
        <span>標籤</span>
        <button class="text-btn" class:on={current === "folders"} onclick={() => ongo("folders")}>整理</button>
      </div>

      <div class="list">
        {#each folders as f (f.name)}
          {@const shut = collapsed.includes(f.name)}
          <div class="folder" class:on={current === `folder:${f.name}`}>
            <button class="item grow" onclick={() => ongo(`folder:${f.name}`)}>
              <Icon name="folder" size={22} />
              <span class="label clip">{f.name}</span>
              {#if f.count}<span class="count">{f.count}</span>{/if}
            </button>
            <button class="caret" class:shut onclick={() => toggleFolder(f.name)} aria-label={shut ? `展開 ${f.name}` : `收合 ${f.name}`} aria-expanded={!shut}>
              <Icon name="chevronDown" size={20} />
            </button>
          </div>
          {#if !shut}
            {#each f.tags as t (t.tag)}
              <button class="item inner" class:on={current === `tag:${t.tag}`} class:idle={!t.count} onclick={() => ongo(`tag:${t.tag}`)}>
                <span class="hash">#</span>
                <span class="label clip">{t.tag}</span>
                {#if t.count}<span class="count">{t.count}</span>{/if}
              </button>
            {/each}
          {/if}
        {/each}
        {#each loose as t (t.tag)}
          <button class="item" class:on={current === `tag:${t.tag}`} onclick={() => ongo(`tag:${t.tag}`)}>
            <span class="hash wide">#</span>
            <span class="label clip">{t.tag}</span>
            {#if t.count}<span class="count">{t.count}</span>{/if}
          </button>
        {/each}
        {#if !folders.length && !loose.length}
          <p class="empty">還沒有標籤。新增待辦時輸入 #標籤，就會出現在這裡。</p>
        {/if}
      </div>

      <div class="foot">
        <button class="item" class:on={current === "settings"} onclick={() => ongo("settings")}>
          <Icon name="settings" size={22} />
          <span class="label">設定</span>
          {#if store.appUpdate}<span class="dot" aria-label="有新版本"></span>{/if}
          <span class="count">{store.prefs?.appVersion ?? ""}</span>
        </button>
      </div>
    </nav>
  </div>
{/if}

<style>
  .layer {
    position: fixed;
    inset: 0;
    z-index: 40;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--scrim);
  }
  .drawer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(320px, 85vw);
    display: flex;
    flex-direction: column;
    padding: 12px 12px calc(12px + var(--nav-inset));
    border-radius: 0 16px 16px 0;
    background: var(--c-low);
  }
  .brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 4px 12px 16px;
  }
  .name {
    font-size: 22px;
    font-weight: 700;
  }
  .section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 0 16px;
    font-size: 14px;
    font-weight: 700;
    color: var(--sub);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .folder {
    display: flex;
    align-items: center;
    border-radius: 28px;
  }
  .item {
    width: 100%;
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    border-radius: 26px;
    font-size: 15px;
    font-weight: 500;
    text-align: left;
    color: var(--sub);
  }
  .item.grow {
    flex: 1;
    min-width: 0;
    padding-right: 4px;
  }
  .item.inner {
    height: 44px;
    padding-left: 50px;
    font-weight: 400;
  }
  .item.idle:not(.on) {
    color: var(--faint);
  }
  .item.on,
  .folder.on {
    background: var(--sel);
    color: var(--on-sel);
  }
  .folder.on .item {
    color: var(--on-sel);
  }
  .label {
    flex: 1;
    color: var(--text);
  }
  .item.on .label,
  .folder.on .label {
    color: var(--on-sel);
  }
  .item.idle:not(.on) .label {
    color: var(--faint);
  }
  .hash {
    color: var(--faint);
  }
  .hash.wide {
    width: 22px;
    text-align: center;
    font-size: 17px;
  }
  .count {
    font-size: 13px;
    font-weight: 400;
    color: var(--sub);
  }
  .caret {
    flex: none;
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    color: var(--sub);
    transition: transform 0.2s;
  }
  .caret.shut {
    transform: rotate(-90deg);
  }
  .empty {
    margin: 8px 16px;
    font-size: 14px;
    line-height: 1.6;
    color: var(--sub);
  }
  .foot {
    border-top: 1px solid var(--line);
    margin: 8px 4px 0;
    padding-top: 8px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--warn);
  }
  .text-btn.on {
    background: var(--sel);
    color: var(--on-sel);
  }
</style>
