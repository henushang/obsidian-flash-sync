"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => KnowledgeSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  serverUrl: "https://aiplat.tech",
  code: "",
  token: "",
  syncedIds: [],
  autoSyncMinutes: 0
};
async function api(settings, path, options) {
  const url = settings.serverUrl + "/api/knowledge" + path;
  const headers = {
    "Content-Type": "application/json"
  };
  if (settings.token) headers["Authorization"] = "Bearer " + settings.token;
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
function apiForm(settings, path, body) {
  const url = settings.serverUrl + "/api/knowledge" + path;
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded"
  };
  if (settings.token) headers["Authorization"] = "Bearer " + settings.token;
  return fetch(url, { method: "POST", headers, body }).then((r) => {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
}
var KnowledgeSyncPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.autoTimer = null;
  }
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("sync", "\u95EA\u8BB0\u52A9\u624B\u8BBE\u7F6E", () => {
      this.app.setting.open();
      this.app.setting.openTabById("knowledge-sync");
    });
    this.addSettingTab(new SyncSettingTab(this.app, this));
    this.statusBar = this.addStatusBarItem();
    this.statusBar.style.cursor = "pointer";
    this.statusBar.onclick = () => this.doSync().then((msg) => new import_obsidian.Notice(msg));
    this.updateStatus();
    this.addCommand({
      id: "sync-now",
      name: "\u7ACB\u5373\u540C\u6B65",
      callback: () => this.doSync().then((msg) => new import_obsidian.Notice(msg))
    });
    this.startAutoSync();
  }
  onunload() {
    this.stopAutoSync();
  }
  updateStatus() {
    const count = this.settings.syncedIds.length;
    this.statusBar.setText(count > 0 ? `\u{1F4E5} \u5DF2\u540C\u6B65 ${count} \u6761` : "\u{1F4E5} \u95EA\u8BB0\u52A9\u624B");
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  // ── 登录 ──
  async login(code) {
    const data = await apiForm(this.settings, "/auth/code-login", "code=" + encodeURIComponent(code));
    this.settings.token = data.token;
    this.settings.code = code;
    await this.saveSettings();
    return data;
  }
  // ── 全量同步（清除记录重新同步） ──
  async forceSync() {
    this.settings.syncedIds = [];
    await this.saveSettings();
    return this.doSync();
  }
  // ── 同步 ──
  async doSync() {
    if (!this.settings.token) return "\u274C \u672A\u767B\u5F55\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u8F93\u5165\u914D\u5BF9\u7801";
    try {
      const d = await api(this.settings, "/list?page_size=999");
      const notes = d.items || [];
      if (notes.length === 0) return "\u{1F4ED} \u670D\u52A1\u5668\u6682\u65E0\u7B14\u8BB0";
      let added = 0, skipped = 0;
      for (const n of notes) {
        if (this.settings.syncedIds.includes(n.id)) {
          skipped++;
          continue;
        }
        await this.writeNote(n);
        this.settings.syncedIds.push(n.id);
        added++;
      }
      await this.saveSettings();
      this.updateStatus();
      return `\u2705 \u540C\u6B65\u5B8C\u6210\uFF1A\u65B0\u589E ${added} \u6761${skipped > 0 ? `\uFF0C\u8DF3\u8FC7 ${skipped} \u6761` : ""}`;
    } catch (e) {
      return "\u274C \u540C\u6B65\u5931\u8D25\uFF1A" + (e.message || "\u7F51\u7EDC\u9519\u8BEF");
    }
  }
  // ── 一个主题一个 MD 文件，追加写入 ──
  async writeNote(n) {
    const topic = n.topic || "\u9ED8\u8BA4";
    const content = n.content || "";
    const filePaths = n.file_paths || [];
    const timeStr = (n.created_at || "").slice(0, 16).replace("T", " ");
    const safeTopic = topic.replace(/[/\\:*?"<>|]/g, "-").trim() || "\u672A\u5206\u7C7B";
    const folder = "\u95EA\u8BB0\u52A9\u624B";
    await this.ensureFolder(folder);
    if (n.source === "article") {
      const datePrefix = (n.created_at || "").slice(0, 10) || "";
      const baseName = (datePrefix ? datePrefix + "-" : "") + (n.title || String(n.id)).replace(/[/\\:*?"<>|]/g, "-").trim() || "\u672A\u547D\u540D";
      const dir = `${folder}/${safeTopic}`;
      await this.ensureFolder(dir);
      let mdPath = `${dir}/${baseName}.md`;
      let counter = 1;
      while (await this.app.vault.adapter.exists(mdPath)) {
        mdPath = `${dir}/${baseName}_${counter}.md`;
        counter++;
      }
      if (!n.article_text) console.warn("[flash-sync] article without text:", n.id, n.title);
      const articleContent = n.article_text || content || "(\u6682\u65E0\u6B63\u6587)";
      const md = `> \u539F\u6587\uFF1A${content}

---

${articleContent}
`;
      await this.app.vault.create(mdPath, md);
      const topicFile = `${folder}/${safeTopic}.md`;
      const refLine = `
## ${timeStr}

\u{1F4C4} [${n.title || baseName}](${safeTopic}/${baseName}.md)

---
`;
      if (await this.app.vault.adapter.exists(topicFile)) {
        const existing = await this.app.vault.adapter.read(topicFile);
        await this.app.vault.adapter.write(topicFile, existing + refLine);
      } else {
        await this.app.vault.create(topicFile, `# ${topic}

> \u81EA\u52A8\u540C\u6B65\u81EA\u95EA\u8BB0\u52A9\u624B
${refLine}`);
      }
    } else {
      const mdPath = `${folder}/${safeTopic}.md`;
      const lines = [];
      lines.push("");
      lines.push(`## ${timeStr}`);
      lines.push("");
      if (content) lines.push(content, "");
      for (const fp of filePaths) {
        const imgUrl = this.settings.serverUrl + "/obsidian-inbox/" + fp;
        lines.push(`![${fp}](${imgUrl})`, "");
      }
      lines.push("---", "");
      const entry = lines.join("\n");
      if (!await this.app.vault.adapter.exists(mdPath)) {
        await this.app.vault.create(mdPath, `# ${topic}

> \u81EA\u52A8\u540C\u6B65\u81EA\u95EA\u8BB0\u52A9\u624B

${entry}`);
      } else {
        const existing = await this.app.vault.adapter.read(mdPath);
        await this.app.vault.adapter.write(mdPath, existing + entry);
      }
    }
  }
  async ensureFolder(path) {
    const parts = path.split("/");
    let current = "";
    for (const p of parts) {
      current = current ? `${current}/${p}` : p;
      if (!await this.app.vault.adapter.exists(current)) {
        try {
          await this.app.vault.createFolder(current);
        } catch {
        }
      }
    }
  }
  // ── 自动同步 ──
  startAutoSync() {
    this.stopAutoSync();
    if (this.settings.autoSyncMinutes > 0 && this.settings.token) {
      this.autoTimer = window.setInterval(() => {
        this.doSync().then((msg) => {
          if (msg.startsWith("\u2705")) new import_obsidian.Notice(msg);
        });
      }, this.settings.autoSyncMinutes * 60 * 1e3);
    }
  }
  stopAutoSync() {
    if (this.autoTimer !== null) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }
};
var SyncSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "\u{1F517} \u95EA\u8BB0\u52A9\u624B\u8BBE\u7F6E" });
    new import_obsidian.Setting(containerEl).setName("\u914D\u5BF9\u7801").setDesc("\u5728\u5FAE\u4FE1\u5C0F\u7A0B\u5E8F\u300C\u684C\u9762\u8FDE\u63A5\u7801\u300D\u4E2D\u83B7\u53D6").addText((t) => {
      t.inputEl.style.textTransform = "uppercase";
      t.inputEl.style.fontFamily = "monospace";
      t.inputEl.style.fontSize = "18px";
      t.inputEl.style.letterSpacing = "4px";
      t.setValue(this.plugin.settings.code).onChange((v) => {
        this.plugin.settings.code = v.toUpperCase();
      });
    }).addButton((b) => b.setButtonText("\u8FDE\u63A5").onClick(async () => {
      const code = this.plugin.settings.code.trim().toUpperCase();
      if (!code || code.length !== 6) {
        new import_obsidian.Notice("\u8BF7\u8F93\u51656\u4F4D\u914D\u5BF9\u7801");
        return;
      }
      try {
        await this.plugin.login(code);
        new import_obsidian.Notice("\u2705 \u8FDE\u63A5\u6210\u529F");
        this.display();
      } catch (e) {
        new import_obsidian.Notice("\u274C \u8FDE\u63A5\u5931\u8D25\uFF1A" + (e.message || "\u7F51\u7EDC\u9519\u8BEF"));
      }
    }));
    if (this.plugin.settings.token) {
      containerEl.createEl("p", {
        text: "\u2705 \u5DF2\u8FDE\u63A5\uFF08\u914D\u5BF9\u7801\uFF1A" + this.plugin.settings.code + "\uFF09",
        attr: { style: "color: var(--color-green); font-size: 13px;" }
      });
    }
    new import_obsidian.Setting(containerEl).setName("\u624B\u52A8\u540C\u6B65").setDesc("\u4ECE\u670D\u52A1\u5668\u62C9\u53D6\u7B14\u8BB0\u5230\u672C\u5730 Vault").addButton((b) => b.setButtonText("\u7ACB\u5373\u540C\u6B65").onClick(async () => {
      const msg = await this.plugin.doSync();
      new import_obsidian.Notice(msg);
      this.display();
    }));
    new import_obsidian.Setting(containerEl).setName("\u5168\u91CF\u540C\u6B65").setDesc("\u6E05\u9664\u540C\u6B65\u8BB0\u5F55\uFF0C\u91CD\u65B0\u540C\u6B65\u6240\u6709\u7B14\u8BB0").addButton((b) => b.setButtonText("\u5168\u91CF\u540C\u6B65").onClick(async () => {
      const msg = await this.plugin.forceSync();
      new import_obsidian.Notice(msg);
      this.display();
    }));
    new import_obsidian.Setting(containerEl).setName("\u81EA\u52A8\u540C\u6B65").setDesc("\u6BCF\u9694\u6307\u5B9A\u5206\u949F\u81EA\u52A8\u540C\u6B65\uFF080=\u5173\u95ED\uFF09").addText((t) => t.setValue(String(this.plugin.settings.autoSyncMinutes)).onChange(async (v) => {
      const m = parseInt(v) || 0;
      this.plugin.settings.autoSyncMinutes = m;
      await this.plugin.saveSettings();
      this.plugin.startAutoSync();
    }));
    if (this.plugin.settings.syncedIds.length > 0) {
      containerEl.createEl("p", {
        text: `\u{1F4CA} \u5DF2\u540C\u6B65 ${this.plugin.settings.syncedIds.length} \u6761\u7B14\u8BB0`,
        attr: { style: "color: var(--text-muted); font-size: 13px;" }
      });
    }
  }
};
