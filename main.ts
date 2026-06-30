import { App, Plugin, PluginSettingTab, Setting, Notice, TFile } from 'obsidian';

// ── 配置 ──
interface SyncSettings {
	serverUrl: string;
	code: string;
	token: string;
	syncedIds: number[];
	autoSyncMinutes: number;
}

const DEFAULT_SETTINGS: SyncSettings = {
	serverUrl: 'https://aiplat.tech',
	code: '',
	token: '',
	syncedIds: [],
	autoSyncMinutes: 0,
}

// ── API 工具 ──
async function api(settings: SyncSettings, path: string, options?: RequestInit) {
	const url = settings.serverUrl + '/api/knowledge' + path;
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (settings.token) headers['Authorization'] = 'Bearer ' + settings.token;
	const res = await fetch(url, { ...options, headers });
	if (!res.ok) throw new Error('HTTP ' + res.status);
	return res.json();
}

function apiForm(settings: SyncSettings, path: string, body: string) {
	const url = settings.serverUrl + '/api/knowledge' + path;
	const headers: Record<string, string> = {
		'Content-Type': 'application/x-www-form-urlencoded',
	};
	if (settings.token) headers['Authorization'] = 'Bearer ' + settings.token;
	return fetch(url, { method: 'POST', headers, body }).then(r => {
		if (!r.ok) throw new Error('HTTP ' + r.status);
		return r.json();
	});
}

// ── 主插件 ──
export default class KnowledgeSyncPlugin extends Plugin {
	settings: SyncSettings;
	private statusBar: HTMLElement;
	private autoTimer: number | null = null;

	async onload() {
		await this.loadSettings();

		// 侧边栏图标
		this.addRibbonIcon('sync', '闪记助手设置', () => {
			this.app.setting.open();
			this.app.setting.openTabById('knowledge-sync');
		});

		this.addSettingTab(new SyncSettingTab(this.app, this));

		// 状态栏 — 点击同步
		this.statusBar = this.addStatusBarItem();
		this.statusBar.style.cursor = 'pointer';
		this.statusBar.onclick = () => this.doSync().then(msg => new Notice(msg));
		this.updateStatus();

		// 命令
		this.addCommand({
			id: 'sync-now',
			name: '立即同步',
			callback: () => this.doSync().then(msg => new Notice(msg)),
		});

		this.startAutoSync();
	}

	onunload() {
		this.stopAutoSync();
	}

	updateStatus() {
		const count = this.settings.syncedIds.length;
		this.statusBar.setText(count > 0 ? `📥 已同步 ${count} 条` : '📥 闪记助手');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ── 登录 ──
	async login(code: string) {
		const data = await apiForm(this.settings, '/auth/code-login', 'code=' + encodeURIComponent(code));
		this.settings.token = data.token;
		this.settings.code = code;
		await this.saveSettings();
		return data;
	}

	// ── 全量同步（清除记录重新同步） ──
	async forceSync(): Promise<string> {
		this.settings.syncedIds = [];
		await this.saveSettings();
		return this.doSync();
	}

	// ── 同步 ──
	async doSync(): Promise<string> {
		if (!this.settings.token) return '❌ 未登录，请在设置中输入配对码';
		try {
			const d = await api(this.settings, '/list?page_size=999');
			const notes: any[] = d.items || [];
			if (notes.length === 0) return '📭 服务器暂无笔记';

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
			return `✅ 同步完成：新增 ${added} 条${skipped > 0 ? `，跳过 ${skipped} 条` : ''}`;
		} catch (e: any) {
			return '❌ 同步失败：' + (e.message || '网络错误');
		}
	}

	// ── 一个主题一个 MD 文件，追加写入 ──
	private async writeNote(n: any) {
		const topic = n.topic || '默认';
		const content = n.content || '';
		const filePaths: string[] = n.file_paths || [];
		const timeStr = (n.created_at || '').slice(0, 16).replace('T', ' ');
		const safeTopic = topic.replace(/[/\\:*?"<>|]/g, '-').trim() || '未分类';
		const folder = '闪记助手';
		await this.ensureFolder(folder);

		if (n.source === 'article') {
			const datePrefix = (n.created_at || '').slice(0, 10) || '';
			const baseName = (datePrefix ? datePrefix + '-' : '') + (n.title || String(n.id)).replace(/[/\\:*?"<>|]/g, '-').trim() || '未命名';
			const dir = `${folder}/${safeTopic}`;
			await this.ensureFolder(dir);
			let mdPath = `${dir}/${baseName}.md`;
			let counter = 1;
			while (await this.app.vault.adapter.exists(mdPath)) {
				mdPath = `${dir}/${baseName}_${counter}.md`;
				counter++;
			}
			const articleContent = n.article_text || content;
			const md = `> 原文：${content}\n\n---\n\n${articleContent}\n`;
			await this.app.vault.create(mdPath, md);

			// 追加引用到主题主文件
			const topicFile = `${folder}/${safeTopic}.md`;
			const refLine = `\n## ${timeStr}\n\n📄 [${n.title || baseName}](${safeTopic}/${baseName}.md)\n\n---\n`;
			if (await this.app.vault.adapter.exists(topicFile)) {
				const existing = await this.app.vault.adapter.read(topicFile);
				await this.app.vault.adapter.write(topicFile, existing + refLine);
			} else {
				await this.app.vault.create(topicFile, `# ${topic}\n\n> 自动同步自闪记助手\n${refLine}`);
			}
		} else {
			const mdPath = `${folder}/${safeTopic}.md`;
			const lines: string[] = [];
			lines.push('');
			lines.push(`## ${timeStr}`);
			lines.push('');
			if (content) lines.push(content, '');
			for (const fp of filePaths) {
				const imgUrl = this.settings.serverUrl + '/obsidian-inbox/' + fp;
				lines.push(`![${fp}](${imgUrl})`, '');
			}
			lines.push('---', '');
			const entry = lines.join('\n');
			if (!(await this.app.vault.adapter.exists(mdPath))) {
				await this.app.vault.create(mdPath, `# ${topic}\n\n> 自动同步自闪记助手\n\n${entry}`);
			} else {
				const existing = await this.app.vault.adapter.read(mdPath);
				await this.app.vault.adapter.write(mdPath, existing + entry);
			}
		}
	}

	private async ensureFolder(path: string) {
		const parts = path.split('/');
		let current = '';
		for (const p of parts) {
			current = current ? `${current}/${p}` : p;
			if (!(await this.app.vault.adapter.exists(current))) {
				try { await this.app.vault.createFolder(current); } catch {}
			}
		}
	}

	// ── 自动同步 ──
	private startAutoSync() {
		this.stopAutoSync();
		if (this.settings.autoSyncMinutes > 0 && this.settings.token) {
			this.autoTimer = window.setInterval(() => {
				this.doSync().then(msg => {
					if (msg.startsWith('✅')) new Notice(msg);
				});
			}, this.settings.autoSyncMinutes * 60 * 1000);
		}
	}

	private stopAutoSync() {
		if (this.autoTimer !== null) {
			clearInterval(this.autoTimer);
			this.autoTimer = null;
		}
	}
}

// ── 设置页 ──
class SyncSettingTab extends PluginSettingTab {
	plugin: KnowledgeSyncPlugin;

	constructor(app: App, plugin: KnowledgeSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: '🔗 闪记助手设置' });

		// 配对码
		new Setting(containerEl)
			.setName('配对码')
			.setDesc('在微信小程序「桌面连接码」中获取')
			.addText(t => {
				t.inputEl.style.textTransform = 'uppercase';
				t.inputEl.style.fontFamily = 'monospace';
				t.inputEl.style.fontSize = '18px';
				t.inputEl.style.letterSpacing = '4px';
				t.setValue(this.plugin.settings.code)
				.onChange(v => {
					this.plugin.settings.code = v.toUpperCase();
				});
			})
			.addButton(b => b
				.setButtonText('连接')
				.onClick(async () => {
					const code = this.plugin.settings.code.trim().toUpperCase();
					if (!code || code.length !== 6) {
						new Notice('请输入6位配对码');
						return;
					}
					try {
						await this.plugin.login(code);
						new Notice('✅ 连接成功');
						this.display();
					} catch (e: any) {
						new Notice('❌ 连接失败：' + (e.message || '网络错误'));
					}
				}));

		if (this.plugin.settings.token) {
			containerEl.createEl('p', {
				text: '✅ 已连接（配对码：' + this.plugin.settings.code + '）',
				attr: { style: 'color: var(--color-green); font-size: 13px;' }
			});
		}

		// 手动同步
		new Setting(containerEl)
			.setName('手动同步')
			.setDesc('从服务器拉取笔记到本地 Vault')
			.addButton(b => b
				.setButtonText('立即同步')
				.onClick(async () => {
					const msg = await this.plugin.doSync();
					new Notice(msg);
					this.display();
				}));

		// 全量同步
		new Setting(containerEl)
			.setName('全量同步')
			.setDesc('清除同步记录，重新同步所有笔记')
			.addButton(b => b
				.setButtonText('全量同步')
				.onClick(async () => {
					const msg = await this.plugin.forceSync();
					new Notice(msg);
					this.display();
				}));

		// 自动同步
		new Setting(containerEl)
			.setName('自动同步')
			.setDesc('每隔指定分钟自动同步（0=关闭）')
			.addText(t => t
				.setValue(String(this.plugin.settings.autoSyncMinutes))
				.onChange(async v => {
					const m = parseInt(v) || 0;
					this.plugin.settings.autoSyncMinutes = m;
					await this.plugin.saveSettings();
					this.plugin.startAutoSync();
				}));

		// 统计
		if (this.plugin.settings.syncedIds.length > 0) {
			containerEl.createEl('p', {
				text: `📊 已同步 ${this.plugin.settings.syncedIds.length} 条笔记`,
				attr: { style: 'color: var(--text-muted); font-size: 13px;' }
			});
		}
	}
}
