<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { store } from "../lib/store.svelte";
  import { toast } from "../lib/toast.svelte";
  import type { Folder } from "../lib/types";

  let { onupdatecloud }: { onupdatecloud: () => void } = $props();

  let newName = $state("");
  /** 正在選要放進哪個資料夾的未分類標籤 */
  let moving = $state<string | null>(null);

  const folders = $derived(store.folders);
  const used = $derived(new Set(store.tags));
  const locked = $derived(!store.supportsFolders);
  const countOf = (tag: string) => store.allOpen.filter((t) => t.tag === tag).length;

  function save(next: Folder[]) {
    if (locked) return;
    store.setFolders(next);
  }

  function add(e: SubmitEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (folders.some((f) => f.name === name)) return toast.error(`已經有「${name}」資料夾了`);
    save([...folders, { name, tags: [] }]);
    newName = "";
  }

  function rename(i: number, input: HTMLInputElement) {
    const name = input.value.trim();
    const old = folders[i].name;
    if (name === old) return;
    if (!name || folders.some((f) => f.name === name)) {
      input.value = old;
      if (name) toast.error(`已經有「${name}」資料夾了`);
      return;
    }
    save(folders.map((f, j) => (j === i ? { ...f, name } : f)));
  }

  function move(i: number, by: number) {
    const next = [...folders];
    const [f] = next.splice(i, 1);
    next.splice(i + by, 0, f);
    save(next);
  }

  function remove(i: number) {
    const before = folders;
    save(folders.filter((_, j) => j !== i));
    toast.show(`已刪除「${before[i].name}」，裡面的標籤回到未分類`, { undo: () => save(before) });
  }

  /** 把標籤放進第 i 個資料夾（原本在別的資料夾就移過來） */
  function put(tag: string, i: number) {
    moving = null;
    save(folders.map((f, j) => ({ ...f, tags: j === i ? [...f.tags.filter((t) => t !== tag), tag] : f.tags.filter((t) => t !== tag) })));
  }

  function takeOut(tag: string) {
    save(folders.map((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) })));
  }

  function onPick(i: number, select: HTMLSelectElement) {
    const tag = select.value;
    select.value = "";
    if (tag) put(tag, i);
  }
</script>

<div class="folders">
  <h1>整理標籤</h1>
  <p class="lead">把標籤放進資料夾，小工具上方就只會顯示資料夾，點開再選裡面的標籤。資料夾只影響顯示，每台電腦都會同步。</p>

  {#if locked}
    <section class="card callout">
      <div>
        <h2>需要先更新雲端</h2>
        <p class="hint">資料夾存在你的雲端上，舊版雲端還不支援。</p>
      </div>
      <button class="primary" onclick={onupdatecloud}>更新雲端</button>
    </section>
  {/if}

  {#each folders as f, i (f.name)}
    <section class="card folder">
      <div class="head">
        <span class="ficon"><Icon name="folder" /></span>
        <input class="name" value={f.name} maxlength="40" disabled={locked} aria-label="資料夾名稱"
          onchange={(e) => rename(i, e.currentTarget)}
          onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
        <button class="icon-btn up" disabled={locked || i === 0} onclick={() => move(i, -1)} aria-label="往上移" title="往上移"><Icon name="chevron" /></button>
        <button class="icon-btn down" disabled={locked || i === folders.length - 1} onclick={() => move(i, 1)} aria-label="往下移" title="往下移"><Icon name="chevron" /></button>
        <button class="icon-btn" disabled={locked} onclick={() => remove(i)} aria-label="刪除資料夾" title="刪除資料夾"><Icon name="trash" /></button>
      </div>
      <div class="tags">
        {#each f.tags as tag (tag)}
          <span class="pill" class:unused={!used.has(tag)} title={used.has(tag) ? "" : "目前沒有待辦用這個標籤"}>
            <span class="clip" title="#{tag}">#{tag}</span>{#if countOf(tag)}<span class="n">{countOf(tag)}</span>{/if}
            <button disabled={locked} onclick={() => takeOut(tag)} aria-label="移出「{tag}」"><Icon name="close" size={11} stroke={2} /></button>
          </span>
        {/each}
        <select class="pick" disabled={locked} onchange={(e) => onPick(i, e.currentTarget)} aria-label="加入標籤到「{f.name}」">
          <option value="">＋ 加入標籤</option>
          {#if store.looseTags.length}
            <optgroup label="未分類">
              {#each store.looseTags as tag (tag)}<option value={tag}>#{tag}</option>{/each}
            </optgroup>
          {/if}
          {#each folders as other, j (other.name)}
            {#if j !== i && other.tags.length}
              <optgroup label="從「{other.name}」移過來">
                {#each other.tags as tag (tag)}<option value={tag}>#{tag}</option>{/each}
              </optgroup>
            {/if}
          {/each}
        </select>
      </div>
    </section>
  {/each}

  <form class="card add" onsubmit={add}>
    <input bind:value={newName} placeholder="新資料夾名稱，例如：課程" maxlength="40" disabled={locked} />
    <button class="ghost" disabled={locked || !newName.trim()}><Icon name="plus" size={14} />新增資料夾</button>
  </form>

  {#if store.looseTags.length}
    <section class="loose">
      <h2>未分類</h2>
      <div class="tags">
        {#each store.looseTags as tag (tag)}
          <button class="pill" class:on={moving === tag} disabled={locked || !folders.length}
            onclick={() => (moving = moving === tag ? null : tag)}>
            <span class="clip" title="#{tag}">#{tag}</span>{#if countOf(tag)}<span class="n">{countOf(tag)}</span>{/if}
          </button>
        {/each}
      </div>
      {#if moving}
        <div class="move-to">
          <span>把 #{moving} 放進</span>
          {#each folders as f, i (f.name)}
            <button class="ghost" onclick={() => put(moving!, i)}><Icon name="folder" size={13} />{f.name}</button>
          {/each}
          <button class="link" onclick={() => (moving = null)}>取消</button>
        </div>
      {:else if folders.length}
        <p class="hint">點一下標籤，選要放進哪個資料夾。</p>
      {:else}
        <p class="hint">先在上面新增一個資料夾。</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .folders {
    max-width: 640px;
    margin: 0 auto;
    padding: 28px 32px 40px;
  }
  h1 {
    font-size: 26px;
    font-weight: 700;
    margin: 0 0 6px;
  }
  .lead {
    margin: 0 0 20px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--sub);
  }
  h2 {
    font-size: 13px;
    font-weight: 700;
    color: var(--sub);
    margin: 0 0 10px;
  }
  .card {
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 12px;
  }
  .callout {
    display: flex;
    align-items: center;
    gap: 16px;
    justify-content: space-between;
    border-color: var(--accent);
  }
  .callout h2 {
    margin: 0;
    color: var(--text);
  }
  .hint {
    font-size: 12px;
    color: var(--faint);
    margin: 4px 0 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 10px;
  }
  .ficon {
    color: var(--accent);
    display: grid;
    place-items: center;
    width: 22px;
  }
  .name {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 8px;
    border-radius: 7px;
    border: 1px solid transparent;
    background: transparent;
    font-size: 15px;
    font-weight: 600;
    outline: none;
  }
  .name:hover:not(:disabled) {
    border-color: var(--line);
  }
  .name:focus {
    border-color: var(--accent);
    background: var(--bg2);
  }
  .up :global(svg) {
    transform: rotate(-90deg);
  }
  .down :global(svg) {
    transform: rotate(90deg);
  }
  .icon-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .pill {
    height: 28px;
    padding: 0 6px 0 11px;
    border-radius: 999px;
    background: var(--bg2);
    font-size: 12.5px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text);
  }
  .pill {
    max-width: 100%;
  }
  .pill .n,
  .pill button {
    flex: none;
  }
  .pick {
    max-width: 100%;
  }
  .pill .n {
    font-size: 11px;
    color: var(--faint);
  }
  .pill button {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--faint);
  }
  .pill button:hover:not(:disabled) {
    background: var(--hover);
    color: var(--text);
  }
  .pill.unused {
    color: var(--faint);
  }
  button.pill {
    padding: 0 11px;
  }
  button.pill:hover:not(:disabled) {
    background: var(--hover);
  }
  button.pill.on {
    background: var(--text);
    color: var(--bg);
  }
  button.pill.on .n {
    color: inherit;
    opacity: 0.75;
  }
  .pick {
    height: 28px;
    padding: 0 8px;
    border-radius: 999px;
    border: 1px dashed var(--line);
    background: transparent;
    color: var(--sub);
    font-size: 12.5px;
    outline: none;
    cursor: pointer;
  }
  .pick:focus {
    border-color: var(--accent);
  }
  .pick option,
  .pick optgroup {
    background: var(--raised);
    color: var(--text);
  }
  .add {
    display: flex;
    gap: 8px;
    padding: 10px 12px;
  }
  .add input {
    flex: 1;
    min-width: 0;
    height: 34px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg2);
    outline: none;
    font-size: 13px;
  }
  .add input:focus {
    border-color: var(--accent);
    background: var(--raised);
  }
  .add .ghost {
    gap: 6px;
  }
  .loose {
    margin-top: 24px;
    padding: 0 4px;
  }
  .move-to {
    margin-top: 12px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--sub);
  }
  .move-to .ghost {
    height: 30px;
    gap: 6px;
  }
</style>
