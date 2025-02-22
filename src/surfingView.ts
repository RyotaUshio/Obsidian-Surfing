import {
	Editor, HoverPopover,
	htmlToMarkdown,
	ItemView,
	MarkdownView, Menu, MenuItem,
	moment, Notice,
	ViewStateResult,
	WorkspaceLeaf
} from "obsidian";
import { HeaderBar } from "./component/HeaderBar";
// @ts-ignore
import { clipboard, remote } from "electron";
import SurfingPlugin from "./surfingIndex";
import { t } from "./translations/helper";
import searchBox from "./component/SearchBox";
import { SEARCH_ENGINES } from "./surfingPluginSetting";
import { OmniSearchContainer } from "./component/OmniSearchContainer";
import { BookMarkBar, updateBookmarkBar } from "./component/BookMarkBar/BookMarkBar";
import { loadJson, saveJson } from "./utils/json";
import { hashCode } from "./component/BookmarkManager/utils";
import { PopoverWebView } from "./component/PopoverWebView";

export const WEB_BROWSER_VIEW_ID = "surfing-view";

export class SurfingView extends ItemView {
	plugin: SurfingPlugin;
	private searchBox: searchBox;
	currentUrl: string;
	currentTitle = "Surfing";

	headerBar: HeaderBar;
	favicon: HTMLImageElement;
	webviewEl: HTMLWebViewElement;
	private menu: Menu;

	private hoverPopover: HoverPopover;
	private searchContainer: OmniSearchContainer;

	bookmarkBar: BookMarkBar;

	private loaded = false;

	private doc: Document;

	private omnisearchEnabled: boolean;

	constructor(leaf: WorkspaceLeaf, plugin: SurfingPlugin) {
		super(leaf);
		this.plugin = plugin;

		// TODO: Add a search box in next version.
		this.omnisearchEnabled = false;
		// this.omnisearchEnabled = app.plugins.enabledPlugins.has("omnisearch");

	}

	static spawnWebBrowserView(newLeaf: boolean, state: WebBrowserViewState) {
		const pluginSettings = app.plugins.getPlugin("surfing").settings;
		const isOpenInSameTab = pluginSettings.openInSameTab;
		const highlightInSameTab = pluginSettings.highlightInSameTab;
		if (!isOpenInSameTab || state.url.startsWith("file://")) {
			if (state.url.contains("bilibili")) {
				for (let i = 0; i < app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID).length; i++) {
					if (app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[i].getViewState().state.url.split('?t=')[0] === state.url.split('?t=')[0]) {
						// @ts-ignore
						app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[i].view.navigate(state.url, false, true);
						(app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[i]).rebuildView();
						app.workspace.setActiveLeaf((app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[i]));
						return;
					}
				}
			} else if (state.url.contains("#:~:text=") && highlightInSameTab) {
				for (let i = 0; i < app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID).length; i++) {
					if (app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[i].getViewState().state.url.split('#:~:text=')[0] === state.url.split('#:~:text=')[0]) {
						// @ts-ignore
						app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[i].view.navigate(state.url, false, true);
						(app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[i]).rebuildView();
						app.workspace.setActiveLeaf((app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[i]));
						return;
					}
				}
			}

			app.workspace.getLeaf(newLeaf).setViewState({
				type: WEB_BROWSER_VIEW_ID,
				active: state.active ?? true,
				state
			});


			return;
		}

		const leafId = app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID).length ? localStorage.getItem("web-browser-leaf-id") : app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[0]?.id;
		if (!leafId) {
			// Check if current leaf is empty view or markdown view.
			let activeViewLeaf: WorkspaceLeaf | undefined;
			activeViewLeaf = app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
			const currentViewType = app.workspace.getActiveViewOfType(ItemView)?.getViewType();
			if (!activeViewLeaf) activeViewLeaf = (currentViewType === "empty" || currentViewType === "surfing-bookmark-manager") ? app.workspace.getActiveViewOfType(ItemView)?.leaf : undefined;
			if (!activeViewLeaf) return;

			const leaf = currentViewType === "empty" ? activeViewLeaf : app.workspace.createLeafBySplit(activeViewLeaf) as WorkspaceLeaf;
			localStorage.setItem("web-browser-leaf-id", leaf.id);

			leaf.setViewState({type: WEB_BROWSER_VIEW_ID, active: true, state});

			if (!(leaf.view.getViewType() === "empty")) {
				leaf.rebuildView();
			}

			leaf.setPinned(true);
			leaf.tabHeaderInnerTitleEl.parentElement?.parentElement?.addClass("same-tab");
			return;
		} else {

			if (state.active != undefined && state.active == false) {
				app.workspace.getLeaf(newLeaf).setViewState({
					type: WEB_BROWSER_VIEW_ID,
					active: true,
					state
				});

				return;
			}

			if (!app.workspace.getLeafById(leafId)) {
				const newLeafID = app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[0]?.id;
				if (newLeafID) {
					localStorage.setItem("web-browser-leaf-id", newLeafID);


					(app.workspace.getLeafById(newLeafID)?.view as SurfingView).navigate(state.url, true);
					app.workspace.getLeafById(newLeafID)?.rebuildView();


					return;
				}
			}

			if (app.workspace.getLeafById(leafId)?.view.getViewType() === WEB_BROWSER_VIEW_ID) {
				// @ts-ignore
				(app.workspace.getLeafById(leafId)?.view as SurfingView).navigate(state.url, true);
				app.workspace.getLeafById(leafId).rebuildView();
				return;
			}
		}
	}

	getDisplayText(): string {
		return this.currentTitle;
	}

	getViewType(): string {
		return WEB_BROWSER_VIEW_ID;
	}

	openInpecter() {
		// @ts-ignore
		const webContents = remote.webContents.fromId(this.webviewEl.getWebContentsId());
		webContents.openDevTools();
	}

	createWebview = () => {
		this.contentEl.empty();

		if (this.plugin.settings.bookmarkManager.openBookMark) {
			this.bookmarkBar = new BookMarkBar((this.leaf.view as SurfingView), this.plugin);
			this.bookmarkBar.onload();
		}

		const doc = this.contentEl.doc;
		this.webviewEl = doc.createElement('webview');
		this.webviewEl.setAttribute("allowpopups", "");
		// @ts-ignore
		this.webviewEl.partition = "persist:surfing-vault-" + this.app.appId;
		this.webviewEl.addClass("wb-frame");
		this.contentEl.appendChild(this.webviewEl);

		if (this.currentUrl) this.navigate(this.currentUrl);

		this.headerBar.addOnSearchBarEnterListener((url: string) => {
			this.navigate(url);
		});


		this.webviewEl.addEventListener("dom-ready", async (event: any) => {
			// @ts-ignore
			const webContents = remote.webContents.fromId(this.webviewEl.getWebContentsId());

			// Open new browser tab if the web view requests it.
			webContents.setWindowOpenHandler((event: any) => {
				SurfingView.spawnWebBrowserView(true, {
					url: event.url,
					active: event.disposition !== "background-tab",
				});
				return {
					action: "allow",
				};
			});

			await this.registerContextMenuInWebcontents(webContents);
			await this.registerJavascriptInWebcontents(webContents);


			// For getting keyboard event from webview
			webContents.on('before-input-event', (event: any, input: any) => {
				if (input.type !== 'keyDown') {
					return;
				}

				// Create a fake KeyboardEvent from the data provided
				const emulatedKeyboardEvent = new KeyboardEvent('keydown', {
					code: input.code,
					key: input.key,
					shiftKey: input.shift,
					altKey: input.alt,
					ctrlKey: input.control,
					metaKey: input.meta,
					repeat: input.isAutoRepeat
				});

				// TODO: Allow set hotkey in webview;
				if (emulatedKeyboardEvent.key === '/') {
					if (!this.plugin.settings.ignoreList.find((item: string) => this.currentUrl.contains(item.toLowerCase()))) {
						webContents.executeJavaScript(`
											document.activeElement instanceof HTMLInputElement
										`, true).then((result: any) => {
							if (!result) this.headerBar.focus();
						});
						return;
					}
				}


				// TODO Detect pressed hotkeys if exists in default hotkeys list
				// If so, prevent default and execute the hotkey
				// If not, send the event to the webview
				activeDocument.body.dispatchEvent(emulatedKeyboardEvent);

				if (emulatedKeyboardEvent.ctrlKey && emulatedKeyboardEvent.key === 'f') {
					this.searchBox = new searchBox(this.leaf, webContents, this.plugin);
				}
			});

			// TODO: Do we need to show a link that cursor hovering?
			// webContents.on("update-target-url", (event: Event, url: string) => {
			// 	console.log("update-target-url", url);
			// })

			try {
				const highlightFormat = this.plugin.settings.highlightFormat;
				const getCurrentTime = () => {
					let link = "";
					// eslint-disable-next-line no-useless-escape
					const timeString = highlightFormat.match(/\{TIME\:[^\{\}\[\]]*\}/g)?.[0];
					if (timeString) {
						// eslint-disable-next-line no-useless-escape
						const momentTime = moment().format(timeString.replace(/{TIME:([^\}]*)}/g, "$1"));
						link = highlightFormat.replace(timeString, momentTime);
						return link;
					}
					return link;
				};
				webContents.executeJavaScript(`
					window.addEventListener('dragstart', (e) => {
						if(e.ctrlKey || e.metaKey) {
							e.dataTransfer.clearData();
							const selectionText = document.getSelection().toString();
							
							let tempText = encodeURIComponent(selectionText);
							const chineseRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/gi;
							const englishSentence = selectionText.split('\\n');
							
							if (selectionText.match(chineseRegex)?.length > 50) {
								if (englishSentence.length > 1) {
									const fistSentenceWords = englishSentence[0];
									const lastSentenceWords = englishSentence[englishSentence.length - 1];

									tempText = encodeURIComponent(fistSentenceWords.slice(0, 4)) + "," + encodeURIComponent(lastSentenceWords.slice(lastSentenceWords.length - 4, lastSentenceWords.length));
								} else {
									tempText = encodeURIComponent(selectionText.substring(0, 8)) + "," + encodeURIComponent(selectionText.substring(selectionText.length - 8, selectionText.length));
								}
							} else if (englishSentence.length > 1) {

								const fistSentenceWords = englishSentence[0].split(' ');
								const lastSentenceWords = englishSentence[englishSentence.length - 1].split(' ');

								tempText = encodeURIComponent(fistSentenceWords.slice(0, 3).join(' ')) + "," + encodeURIComponent(lastSentenceWords.slice(lastSentenceWords.length - 1, lastSentenceWords.length).join(' '));
							}
							
							const linkToHighlight = e.srcElement.baseURI.replace(/\#\:\~\:text\=(.*)/g, "") + "#:~:text=" + tempText;
							let link = "";
							if ("${highlightFormat}".includes("{TIME")) {
								link = "${getCurrentTime()}";
							}
							link = (link != "" ? link : "${highlightFormat}").replace(/\{URL\}/g, linkToHighlight).replace(/\{CONTENT\}/g, selectionText.replace(/\\n/g, " "));
						
							e.dataTransfer.setData('text/plain', link);
						}
					});
					`, true).then((result: any) => {
				});
			} catch (err) {
				console.error('Failed to add event: ', err);
			}
		});

		// When focus set current leaf active;
		this.webviewEl.addEventListener("focus", (event: any) => {
			app.workspace.setActiveLeaf(this.leaf);
		});

		this.webviewEl.addEventListener("page-favicon-updated", (event: any) => {
			if (event.favicons[0] !== undefined) this.favicon.src = event.favicons[0];
			this.leaf.tabHeaderInnerIconEl.empty();
			this.leaf.tabHeaderInnerIconEl.appendChild(this.favicon);
		});

		this.webviewEl.addEventListener("page-title-updated", (event: any) => {
			if (this.omnisearchEnabled) this.updateSearchBox();
			this.leaf.tabHeaderInnerTitleEl.innerText = event.title;
			this.currentTitle = event.title;
		});

		this.webviewEl.addEventListener("will-navigate", (event: any) => {
			this.navigate(event.url, true, false);
		});

		this.webviewEl.addEventListener("did-navigate-in-page", (event: any) => {
			this.navigate(event.url, true, false);
			this.menu?.close();
		});

		this.webviewEl.addEventListener("new-window", (event: any) => {
			event.preventDefault();
		});

		this.webviewEl.addEventListener("did-attach-webview", (event: any) => {
			console.log("Webview attached");
		});

		this.webviewEl.addEventListener('destroyed', () => {

			if (doc !== this.contentEl.doc) {
				console.log("Webview destroyed");
				this.webviewEl.detach();
				this.createWebview();
			}
		});

		// TODO: Support dark reader soon.
		// this.frame.addEventListener("did-finish-load", (event: any) => {
		// 	// @ts-ignore
		// 	const webContents = remote.webContents.fromId(this.frame.getWebContentsId());
		//
		// 	webContents.executeJavaScript(`
		// 				window.addEventListener('DOMContentLoaded', ()=>{
		// 					DarkReader.setFetchMethod(window.fetch);
		// 					DarkReader.enable({brightness: 100, contrast: 90, sepia: 10});
		// 					console.log("hlewo");
		// 				});
		// 			`, true).then((result: any) => {
		// 	});
		// })

		doc.contains(this.contentEl) ? this.contentEl.appendChild(this.webviewEl) : this.contentEl.onNodeInserted(() => {
			if (this.loaded) return;
			else this.loaded = true;
			this.contentEl.doc === doc ? this.contentEl.appendChild(this.webviewEl) : this.createWebview();
		});
	};

	async onOpen() {
		// Allow views to replace this views.
		this.navigation = true;

		// Create search bar in the header bar.
		this.headerBar = new HeaderBar(this.headerEl.children[2], this.plugin, this, true);
		this.headerBar.onLoad();

		// Create favicon image element.
		this.favicon = document.createElement("img") as HTMLImageElement;
		this.favicon.width = 16;
		this.favicon.height = 16;

		this.contentEl.addClass("wb-view-content");

		// Create main web view frame that displays the website.

		if (this.omnisearchEnabled) this.searchContainer = new OmniSearchContainer(this.leaf, this.plugin);
		if (this.omnisearchEnabled) this.searchContainer.onload();

		this.createWebview();
		this.initHeaderButtons();
	}

	onload() {
		super.onload();
		if (this.menu) this.menu.close();
	}

	initHeaderButtons() {
		this.addAction("settings", t("settings"), () => {
			//@ts-expect-error, private method
			app.setting.open();
			//@ts-expect-error, private method
			app.setting.openTabById('surfing');
		});
		this.addAction("star", t("star"), async () => {
			const jsonData = await loadJson();
			const bookmarks = jsonData.bookmarks;
			try {
				const isBookmarkExist = bookmarks.some((bookmark) => {
					if (bookmark.url === this.currentUrl) {
						return true;
					} else {
						return false;
					}
				});

				if (!isBookmarkExist) {
					// @ts-ignore
					const webContents = remote.webContents.fromId(this.webviewEl.getWebContentsId());

					let description = "";
					try {
						webContents.executeJavaScript(`
							document.querySelector('meta[name="description"]')?.content
						`).then((result: any) => {
							if (result) description = result;
						});
					} catch (err) {
						console.error(err);
					}

					const categories = this.plugin.settings.bookmarkManager.defaultCategory.split(",").map((c) => c.trim());

					bookmarks.unshift({
						id: String(hashCode(this.currentUrl)),
						name: this.currentTitle,
						url: this.currentUrl,
						description: description,
						category: categories.length > 0 ? categories : ["ROOT"],
						tags: "",
						created: moment().valueOf(),
						modified: moment().valueOf(),
					});

					await saveJson({bookmarks: bookmarks, categories: jsonData.categories});

					updateBookmarkBar(bookmarks, jsonData.categories, true);
				} else {
					new Notice("Bookmark already exists.");
				}
			} catch (err) {
				new Notice("Failed to add bookmark.");
				console.log(err);
			}
		});
		if (this.plugin.settings.bookmarkManager.sendToReadWise) this.addAction("book", t("Send to ReadWise"), async () => {
			const sendToReadWise = (title: string, url: string) => {
				open('https://readwise.io/save?title=' + encodeURIComponent(title) + '&url=' + encodeURIComponent(url));
			};

			try {
				await sendToReadWise(this.currentTitle, this.currentUrl);
				new Notice("Save success!");
			} catch (err) {
				new Notice("Save failed!");
			}
		});
	}

	async setState(state: WebBrowserViewState, result: ViewStateResult) {
		this.navigate(state.url, false);
	}

	updateSearchBox() {
		const searchEngines = [...SEARCH_ENGINES, ...this.plugin.settings.customSearchEngine];
		// @ts-ignore
		const regex = /^(?:https?:\/\/)?(?:[^@/\n]+@)?(?:www\.)?([^:/?\n]+)/g;
		const currentUrl = this.currentUrl?.match(regex)?.[0];
		if (!currentUrl) return;
		const currentSearchEngine = searchEngines.find((engine) => engine.url.startsWith(currentUrl));
		if (!currentSearchEngine) return;
		// @ts-ignore
		const webContents = remote.webContents.fromId(this.webviewEl.getWebContentsId());

		try {
			webContents.executeJavaScript(`
											document.querySelector('input')?.value
										`, true).then((result: any) => {
				this.searchContainer.update(result?.toLowerCase());
			});
		} catch (err) {
			console.error('Failed to copy: ', err);
		}
	}

	createMenu = (webContents: any, params: any) => {
		if (this.menu) {
			this.menu?.close();
		}

		this.menu = new Menu() as Menu;

		const navigateBack = () => {
			// @ts-ignore
			this.leaf?.history.back();
		};

		const navigateForward = () => {
			// @ts-ignore
			this.leaf?.history.forward();
		};

		if (!params.selectionText) {
			this.menu.addItem(
				(item: MenuItem) => {
					item.setTitle(t('Refresh Current Page'));
					item.setIcon('refresh-ccw');
					item.onClick(() => {
						this.leaf?.rebuildView();
					});
				}
			).addItem(
				(item: MenuItem) => {
					item.setTitle(t('Back'));
					item.setIcon('arrow-left');
					item.onClick(() => {
						navigateBack();
					});
				}
			).addItem(
				(item: MenuItem) => {
					item.setTitle(t('Forward'));
					item.setIcon('arrow-right');
					item.onClick(() => {
						navigateForward();
					});
				}
			).addSeparator();
		}

		this.menu.addItem(
			(item: MenuItem) => {
				item.setTitle(t('Open Current URL In External Browser'));
				item.setIcon('link');
				item.onClick(() => {
					window.open(params.pageURL, "_blank");
				});
			}
		).addItem(
			(item: MenuItem) => {
				item.setTitle(t('Save Current Page As Markdown'));
				item.setIcon('download');
				item.onClick(async () => {
					try {
						webContents.executeJavaScript(`
											document.body.outerHTML
										`, true).then(async (result: any) => {
							const url = params.pageURL.replace(/\?(.*)/g, "");
							const parseContent = result.replaceAll(/src="(?!(https|http))([^"]*)"/g, "src=\"" + url + "$2\"");
							const content = htmlToMarkdown(parseContent);
							// @ts-ignore
							const currentTitle = webContents.getTitle().replace(/[/\\?%*:|"<>]/g, '-');
							const file = await app.vault.create((app.plugins.getPlugin("surfing").settings.markdownPath ? app.plugins.getPlugin("surfing").settings.markdownPath + "/" : "/") + currentTitle + ".md", content);
							await app.workspace.openLinkText(file.path, "", true);
						});
						console.log('Page Title copied to clipboard');
					} catch (err) {
						console.error('Failed to copy: ', err);
					}

				});
			}
		).addItem(
			(item: MenuItem) => {
				item.setTitle(t('Copy Current Viewport As Image'));
				item.setIcon('image');
				item.onClick(async () => {
					try {
						// Copy Image to Clipboard
						webContents.capturePage().then(async (image: any) => {
							clipboard.writeImage(image);
						});
					} catch (err) {
						console.error('Failed to copy: ', err);
					}

				});
			}
		);

		if (params.selectionText) {
			this.menu.addSeparator();
			this.menu.addItem(
				(item: MenuItem) => {
					item.setTitle(t('Search Text'));
					item.setIcon('search');
					item.onClick(() => {
						try {
							SurfingView.spawnWebBrowserView(true, {url: params.selectionText});
						} catch (err) {
							console.error('Failed to copy: ', err);
						}
					});
				}
			);
			this.menu.addSeparator();
			this.menu.addItem(
				(item: MenuItem) => {
					item.setTitle(t('Copy Plain Text'));
					item.setIcon('copy');
					item.onClick(() => {
						try {
							navigator.clipboard.writeText(params.selectionText);
						} catch (err) {
							console.error('Failed to copy: ', err);
						}
					});
				}
			);
			this.menu.addItem(
				(item: MenuItem) => {
					item.setTitle('Save selection as markdown').setIcon('download').onClick(async () => {
						const content = params.selectionText;
						// @ts-ignore
						const currentTitle = webContents.getTitle().replace(/[/\\?%*:|"<>]/g, '-');
						const file = await app.vault.create((app.plugins.getPlugin("surfing").settings.markdownPath ? app.plugins.getPlugin("surfing").settings.markdownPath + "/" : "/") + currentTitle + ".md", content);
						await app.workspace.openLinkText(file.path, "", true);
					});
				}
			);
			const highlightFormat = this.plugin.settings.highlightFormat;
			this.menu.addItem(
				(item: MenuItem) => {
					item.setTitle(t('Copy Link to Highlight'));
					item.setIcon('link');
					item.onClick(() => {
						try {
							// eslint-disable-next-line no-useless-escape
							let tempText = encodeURIComponent(params.selectionText);
							const chineseRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/gi;
							const englishSentence = params.selectionText.split('\n');

							if (params.selectionText.match(chineseRegex)?.length > 50) {
								if (englishSentence.length > 1) {
									const fistSentenceWords = englishSentence[0];
									const lastSentenceWords = englishSentence[englishSentence.length - 1];

									tempText = encodeURIComponent(fistSentenceWords.slice(0, 3)) + "," + encodeURIComponent(lastSentenceWords.slice(lastSentenceWords.length - 4, lastSentenceWords.length));
								} else {
									tempText = encodeURIComponent(params.selectionText.substring(0, 8)) + "," + encodeURIComponent(params.selectionText.substring(params.selectionText.length - 8, params.selectionText.length));
								}
							} else if (englishSentence.length > 1) {

								const fistSentenceWords = englishSentence[0].split(' ');
								const lastSentenceWords = englishSentence[englishSentence.length - 1].split(' ');

								tempText = encodeURIComponent(fistSentenceWords.slice(0, 3).join(' ')) + "," + encodeURIComponent(lastSentenceWords.slice(lastSentenceWords.length - 1, lastSentenceWords.length).join(' '));
								// tempText = encodeURIComponent(englishWords.slice(0, 2).join(' ')) + "," + encodeURIComponent(englishWords.slice(englishWords.length - 1, englishWords.length).join(' '));
							}

							const linkToHighlight = params.pageURL.replace(/\#\:\~\:text\=(.*)/g, "") + "#:~:text=" + tempText;
							const selectionText = params.selectionText.replace(/\n/g, " ");
							let link = "";
							if (highlightFormat.contains("{TIME")) {
								// eslint-disable-next-line no-useless-escape
								const timeString = highlightFormat.match(/\{TIME\:[^\{\}\[\]]*\}/g)?.[0];
								if (timeString) {
									// eslint-disable-next-line no-useless-escape
									const momentTime = moment().format(timeString.replace(/{TIME:([^\}]*)}/g, "$1"));
									link = highlightFormat.replace(timeString, momentTime);
								}
							}
							link = (link != "" ? link : highlightFormat).replace(/\{URL\}/g, linkToHighlight).replace(/\{CONTENT\}/g, selectionText);
							clipboard.writeText(link);
						} catch (err) {
							console.error('Failed to copy: ', err);
						}
					});
				});
		}

		if (params.pageURL?.contains("bilibili.com/")) {
			this.menu.addSeparator();
			this.menu.addItem(
				(item: MenuItem) => {
					item.setTitle(t('Copy Video Timestamp'));
					item.setIcon('link');
					item.onClick(() => {
						try {
							webContents.executeJavaScript(`
											var time = document.querySelectorAll('.bpx-player-ctrl-time-current')[0].innerHTML;
											var timeYMSArr=time.split(':');
											var joinTimeStr='00h00m00s';
											if(timeYMSArr.length===3){
												 joinTimeStr=timeYMSArr[0]+'h'+timeYMSArr[1]+'m'+timeYMSArr[2]+'s';
											}else if(timeYMSArr.length===2){
												 joinTimeStr=timeYMSArr[0]+'m'+timeYMSArr[1]+'s';
											}
											var timeStr= "";
											var pageStrMatch = window.location.href.match(/(p=[1-9]{1,})/g);
											var pageStr = "";
											if(typeof pageStrMatch === "object" && pageStrMatch?.length > 0){
											    pageStr = '&' + pageStrMatch[0];
											}else if(typeof pageStrMatch === "string") {
											    pageStr = '&' + pageStrMatch;
											}
											timeStr = window.location.href.split('?')[0]+'?t=' + joinTimeStr + pageStr;
										`, true).then((result: any) => {
								clipboard.writeText("[" + result.split('?t=')[1].replace(/&p=[1-9]{1,}/g, "") + "](" + result + ")"); // Will be the JSON object from the fetch call
							});
							console.log('Page URL copied to clipboard');
						} catch (err) {
							console.error('Failed to copy: ', err);
						}
					});
				}
			);
		}

		this.menu.showAtPosition({
			x: params.x,
			y: params.y
		});
	};

	async registerContextMenuInWebcontents(webContents: any) {
		webContents.executeJavaScript(`
			window.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				window.myPostPort?.postMessage('contextmenu ' + e.clientX + ' ' + e.clientY);
			 })
		 `);

		await webContents.executeJavaScript(`
			window.addEventListener("message", (e) => {
				window.myPostPort = e.ports[0];
			})
			document.addEventListener('click', (e) => {
				window.myPostPort?.postMessage('click');
			});
			document.addEventListener('scroll', (e) => {
				window.myPostPort?.postMessage('scroll');
			});0

		`);

		const ch = new MessageChannel();
		ch.port1.onmessage = (e: any) => {
			if (e.data === 'contextmenu' || e.data?.startsWith('contextmenu')) {
				this.menu?.close();
				const {x, y} = e.data.split(' ').length > 1 ? {
					x: e.data.split(' ')[1],
					y: e.data.split(' ')[2]
				} : {x: e.x, y: e.y};
				const realRect = this.webviewEl.getClientRects();
				const rect: {
					x: number,
					y: number
				} = {
					x: parseInt(x, 10) + realRect[0].x,
					y: parseInt(y, 10) + realRect[0].y
				};

				const pageUrl = this.currentUrl;
				let selectionText = "";
				try {
					webContents.executeJavaScript(`window.getSelection().toString()`, true).then((result: any) => {
						selectionText = result;

						console.log(rect, pageUrl, selectionText);

						this.createMenu(webContents, {
							...rect,
							pageURL: pageUrl,
							selectionText: selectionText
						});
					});
				} catch (err) {
					console.error('Failed to copy: ', err);
				}
				return;
			}

			if (e.data && e.data.startsWith('link ')) {
				console.log(e.data);
				if (this.hoverPopover) this.hoverPopover.hide();
				const x = e.data.split(' ')[1];
				const y = e.data.split(' ')[2];
				const url = e.data.split(' ')[3];
				console.log(url);
				if (!url) return;
				if (!url.startsWith("http")) return;
				this.hoverPopover = new HoverPopover(
					<any>this.contentEl,
					null,
					100
				);

				const realRect = this.webviewEl.getClientRects();
				const rect: {
					x: number,
					y: number
				} = {
					x: parseInt(x, 10) + realRect[0].x,
					y: parseInt(y, 10) + realRect[0].y
				};

				setTimeout(() => {
					this.hoverPopover.position({
						x: rect.x,
						y: rect.y,
						doc: this.doc,
					});
				}, 100);

				this.hoverPopover.hoverEl.toggleClass('surfing-hover-popover', true);

				const parentEl = this.hoverPopover.hoverEl.createEl('div', {
					cls: 'surfing-hover-popover-container'
				});
				const webView = new PopoverWebView(parentEl, url);
				webView.onload();
				return;
			}

			if (e.data !== 'darkreader-failed') {
				this.menu?.close();
				this.hoverPopover?.hide();
			} else if (e.data === 'darkreader-failed') {
				webContents.executeJavaScript(`
										window.getComputedStyle( document.body ,null).getPropertyValue('background-color');
							`, true).then((result: any) => {
					const colorArr = result.slice(
						result.indexOf("(") + 1,
						result.indexOf(")")
					).split(", ");

					const brightness = Math.sqrt(colorArr[0] ** 2 * 0.241 + colorArr[1] ** 2 * 0.691 + colorArr[2] ** 2 * 0.068);

					// If the background color is dark, set the theme to dark.
					if (brightness > 120) {
						webContents.insertCSS(`
							html {
								filter: invert(90%) hue-rotate(180deg);
							}

							img, svg, div[class*="language-"] {
								filter: invert(110%) hue-rotate(180deg);
								opacity: .8;
							}

							video, canvas {
								filter: invert(110%) hue-rotate(180deg);
								opacity: 1;
							}
					`);
					}
				});

			}
		};

		await (this.webviewEl as any).contentWindow.postMessage(`test`, '*', [ch.port2]);
	}

	async registerJavascriptInWebcontents(webContents: any) {

		try {
			if (this.plugin.settings.darkMode) {
				try {
					await webContents.executeJavaScript(`
						const element = document.createElement('script');

						fetch('https://cdn.jsdelivr.net/npm/darkreader/darkreader.min.js')
							.then((response) => {
								element.src = response.url;
								document.body.appendChild(element);
							})
							.catch((error) => {
								console.error('Error loading the script:', error);
							});

						element.onload = () => {
							try {
								DarkReader?.setFetchMethod(window.fetch);
								DarkReader?.enable({
									brightness: 100,
									contrast: 90,
									sepia: 10
								});
								console.log(DarkReader);
							} catch (err) {

								window.myPostPort?.postMessage('darkreader-failed');
								console.error('Failed to load dark reader: ', err);

							}
						};0
					`);


				} catch (e) {
					console.error(e);
				}


			}


		} catch (err) {
			console.error('Failed to get background color: ', err);
		}

		// https://cdn.jsdelivr.net/npm/darkreader/darkreader.min.js
		webContents.executeJavaScript(`
			window.addEventListener('mouseover', (e) => {
				if(!e.target) return;
				if(!e.ctrlKey && !e.metaKey) return;
				// Tag name is a tag
				if(e.target.tagName.toLowerCase() === 'a'){
					window.myPostPort?.postMessage('link ' + e.clientX + ' ' + e.clientY + ' ' + e.target.href);
				}
			});
		`);
	}

	clearHistory(): void {
		// @ts-ignore
		const webContents = remote.webContents.fromId(this.webviewEl.getWebContentsId());
		if (!webContents) return;

		webContents.clearHistory();
		webContents.executeJavaScript("history.pushState({}, '', location.href)");

		this.leaf.history.backHistory.splice(0);
		this.leaf.history.forwardHistory.splice(0);
	}

	getState(): WebBrowserViewState {
		return {url: this.currentUrl};
	}

	getCurrentTitle(): string {
		return this.currentTitle;
	}

	navigate(url: string, addToHistory = true, updateWebView = true) {
		if (url === "") {
			return;
		}

		if (addToHistory) {
			if (this.leaf.history.backHistory.last()?.state?.state?.url !== this.currentUrl) {
				this.leaf.history.backHistory.push({
					state: {
						type: WEB_BROWSER_VIEW_ID,
						state: this.getState()
					},
					title: this.currentTitle,
					icon: "search"
				});
				// Enable the arrow highlight on the back arrow because there's now back history.
				this.headerEl.children[1].children[0].setAttribute("aria-disabled", "false");
			}
		}

		// TODO: move this to utils.ts
		// Support both http:// and https://
		// TODO: ?Should we support Localhost?
		// And the before one is : /[-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?/gi; which will only match `blabla.blabla`
		// Support 192.168.0.1 for some local software server, and localhost
		// eslint-disable-next-line no-useless-escape
		const urlRegEx = /^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#?&//=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/g;
		// eslint-disable-next-line no-useless-escape
		const urlRegEx2 = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+(:[0-9]+)?|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w\-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[\w]*))?)/g;

		if (urlRegEx.test(url)) {
			const first7 = url.slice(0, 7).toLowerCase();
			const first8 = url.slice(0, 8).toLowerCase();
			if (!(first7 === "http://" || first7 === "file://" || first8 === "https://")) {
				url = "https://" + url;
			}
		} else if ((!(url.startsWith("file://") || (/\.htm(l)?/g.test(url))) && !urlRegEx2.test(encodeURI(url))) || !(/^(https?|file):\/\//g.test(url))) {
			// If url is not a valid FILE url, search it with search engine.
			const allSearchEngine = [...SEARCH_ENGINES, ...this.plugin.settings.customSearchEngine];
			const currentSearchEngine = allSearchEngine.find((engine) => engine.name.toLowerCase() === this.plugin.settings.defaultSearchEngine);
			console.log(currentSearchEngine, allSearchEngine, this.plugin.settings.defaultSearchEngine);

			// @ts-ignore
			url = (currentSearchEngine ? currentSearchEngine.url : SEARCH_ENGINES[0].url) + url;
		}

		this.currentUrl = url;

		this.headerBar.setSearchBarUrl(url);

		if (updateWebView) {
			this.webviewEl.setAttribute("src", url);
		}
		this.searchBox?.unload();
		app.workspace.requestSaveLayout();
	}

	// TODO: Combine this with context menu method.
	getCurrentTimestamp(editor?: Editor) {
		// @ts-ignore
		const webContents = remote.webContents.fromId(this.webviewEl.getWebContentsId());
		webContents.executeJavaScript(`
					var time = document.querySelectorAll('.bpx-player-ctrl-time-current')[0].innerHTML;
					var timeYMSArr=time.split(':');
					var joinTimeStr='00h00m00s';
					if(timeYMSArr.length===3){
						 joinTimeStr=timeYMSArr[0]+'h'+timeYMSArr[1]+'m'+timeYMSArr[2]+'s';
					}else if(timeYMSArr.length===2){
						 joinTimeStr=timeYMSArr[0]+'m'+timeYMSArr[1]+'s';
					}
					var timeStr= "";
					timeStr = window.location.href.split('?')[0]+'?t=' + joinTimeStr;
				`, true).then((result: any) => {
			const timestamp = "[" + result.split('?t=')[1] + "](" + result + ") ";
			const originalCursor = editor?.posToOffset(editor?.getCursor());
			editor?.replaceRange(timestamp, editor?.getCursor());
			if (originalCursor) editor?.setCursor(editor?.offsetToPos(originalCursor + timestamp.length));
		});
	}

	// TODO: Refresh the page.
	refresh() {
		// @ts-ignore
		const webContents = remote.webContents.fromId(this.webviewEl.getWebContentsId());
		webContents.reload();
	}

	copyHighLight() {
		const highlightFormat = this.plugin.settings.highlightFormat;

		const getCurrentTime = () => {
			let link = "";
			// eslint-disable-next-line no-useless-escape
			const timeString = highlightFormat.match(/\{TIME\:[^\{\}\[\]]*\}/g)?.[0];
			if (timeString) {
				// eslint-disable-next-line no-useless-escape
				const momentTime = moment().format(timeString.replace(/{TIME:([^\}]*)}/g, "$1"));
				link = highlightFormat.replace(timeString, momentTime);
				return link;
			}
			return link;
		};

		const getCurrentUrl = () => {
			return this.currentUrl;
		};

		const checkTime = () => {
			return highlightFormat.includes("{TIME");
		};


		// @ts-ignore
		const webContents = remote.webContents.fromId(this.webviewEl.getWebContentsId());

		webContents.executeJavaScript(`
				const selectionText = document.getSelection().toString();
				let tempText = encodeURIComponent(selectionText);
				const chineseRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/gi;
				const englishSentence = selectionText.split('\\n');

				if (selectionText.match(chineseRegex)?.length > 50) {
					if (englishSentence.length > 1) {
						const fistSentenceWords = englishSentence[0];
						const lastSentenceWords = englishSentence[englishSentence.length - 1];

						tempText = encodeURIComponent(fistSentenceWords.slice(0, 4)) + "," + encodeURIComponent(lastSentenceWords.slice(lastSentenceWords.length - 4, lastSentenceWords.length));
					} else {
						tempText = encodeURIComponent(selectionText.substring(0, 8)) + "," + encodeURIComponent(selectionText.substring(selectionText.length - 8, selectionText.length));
					}
				} else if (englishSentence.length > 1) {

					const fistSentenceWords = englishSentence[0].split(' ');
					const lastSentenceWords = englishSentence[englishSentence.length - 1].split(' ');

					tempText = encodeURIComponent(fistSentenceWords.slice(0, 3).join(' ')) + "," + encodeURIComponent(lastSentenceWords.slice(lastSentenceWords.length - 1, lastSentenceWords.length).join(' '));
				}

				let linkToHighlight = "${getCurrentUrl()}".replace(/\#\:\~\:text\=(.*)/g, "") + "#:~:text=" + tempText;

				let link = "";
				if (${checkTime()}) {
					link = "${getCurrentTime()}";
				}
				link = (link != "" ? link : "${highlightFormat}").replace(/\{URL\}/g, linkToHighlight).replace(/\{CONTENT\}/g, selectionText.replace(/\\n/g, " "));

				`, true).then((result: any) => {
			clipboard.writeText(result);
		});
	}
}

class WebBrowserViewState {
	url: string;
	active?: boolean;
}
