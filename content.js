// content.js - 流水线句子级流式合成 + 主题自动切换 + 精准句子高亮滚动（跳过特殊符号）
console.log('🎯 DeepSeek TTS Content Script loaded (精准高亮 + 跳过符号版)');

// ==================== 全局辅助函数 ====================
function showToast(message, type = 'error') {
    const toast = document.createElement('div');
    toast.textContent = `🔊 DeepSeek TTS: ${message}`;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? '#f44336' : '#4caf50'};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 999999;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        max-width: 300px;
        word-wrap: break-word;
        animation: slideIn 0.3s;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

// ==================== 句子分割器（仅文本）====================
class SentenceSplitter {
    static split(text, locale = 'zh-CN') {
        if (!text || typeof text !== 'string') return [];

        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            try {
                const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
                const segments = Array.from(segmenter.segment(text));
                const sentences = segments.map(s => s.segment.trim()).filter(s => s.length > 0);
                if (sentences.length > 0) {
                    console.log(`📖 Intl.Segmenter 分割出 ${sentences.length} 句`);
                    return sentences;
                }
            } catch (e) {
                console.warn('Intl.Segmenter 失败，降级为正则分割', e);
            }
        }

        const rawSplits = text.split(/(?<=[。！？；：！？；：.!?;:])(?![0-9])/g);
        const sentences = rawSplits
            .map(s => s.trim())
            .filter(s => s.length > 0 && !/^[.!?;:]$/.test(s));

        if (sentences.length === 0) return [text];
        console.log(`📖 正则分割出 ${sentences.length} 句`);
        return sentences;
    }
}

// ==================== 可取消的 EdgeTTS ====================
class AbortableEdgeTTS {
    constructor(text, voice, options = {}) {
        if (typeof window.EdgeTTSBrowser === 'undefined') {
            throw new Error('EdgeTTSBrowser 未定义！请确保 edge-tts-browser.js 已正确加载。');
        }
        this.tts = new window.EdgeTTSBrowser(text, voice, options);
        this.ws = null;
    }

    async synthesize() {
        const originalConnect = this.tts.connect;
        this.tts.connect = async () => {
            await originalConnect.call(this.tts);
            this.ws = this.tts.ws;
            console.log('🔌 WebSocket 连接已建立');
        };

        try {
            const result = await this.tts.synthesize();
            if (!result || !result.audio) throw new Error('合成成功但未返回音频数据');
            return result.audio;
        } catch (e) {
            console.error('❌ AbortableEdgeTTS.synthesize 失败:', e);
            throw e;
        }
    }

    abort() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
            console.log('🛑 WebSocket 已强制关闭');
        }
    }
}

// ==================== 并发合成流水线 ====================
class SynthesisPipeline {
    constructor(maxConcurrency = 2) {
        this.queue = [];
        this.activeTasks = [];
        this.maxConcurrency = maxConcurrency;
        this.cancelled = false;
        this.onAudioReady = null;
    }

    addSentence(index, text, voice, settings) {
        if (this.cancelled) {
            console.warn(`🛑 流水线已取消，忽略句子 ${index}`);
            return;
        }
        this.queue.push({ index, text, voice, settings });
        console.log(`📥 添加句子 ${index} 到队列，当前队列长度: ${this.queue.length}`);
        this.processQueue();
    }

    processQueue() {
        if (this.cancelled) return;
        while (this.activeTasks.length < this.maxConcurrency && this.queue.length > 0) {
            const task = this.queue.shift();
            this.startTask(task);
        }
    }

    async startTask({ index, text, voice, settings }) {
        console.log(`🎬 开始合成句子 ${index}（并发 ${this.activeTasks.length + 1}/${this.maxConcurrency}），文本长度: ${text.length}`);

        const formattedOptions = {
            rate: this.formatTTSValue(settings.rate, '%'),
            volume: this.formatTTSValue(settings.volume, '%'),
            pitch: this.formatTTSValue(settings.pitch, 'Hz')
        };

        let tts;
        try {
            tts = new AbortableEdgeTTS(text, voice, formattedOptions);
        } catch (e) {
            console.error(`❌ 创建 AbortableEdgeTTS 失败:`, e);
            if (!this.cancelled && this.onAudioReady) this.onAudioReady(index, null);
            this.onTaskFinished(index);
            return;
        }

        this.activeTasks.push(tts);

        try {
            const audioBlob = await tts.synthesize();
            if (!this.cancelled && this.onAudioReady) {
                console.log(`✅ 句子 ${index} 合成成功，音频大小: ${audioBlob.size} bytes`);
                this.onAudioReady(index, audioBlob);
            }
        } catch (e) {
            console.error(`❌ 句子 ${index} 合成失败:`, e);
            if (!this.cancelled && this.onAudioReady) this.onAudioReady(index, null);
        } finally {
            this.activeTasks = this.activeTasks.filter(task => task !== tts);
            this.onTaskFinished(index);
        }
    }

    onTaskFinished(index) {
        console.log(`🏁 句子 ${index} 合成任务结束，剩余队列: ${this.queue.length}，活跃任务: ${this.activeTasks.length}`);
        this.processQueue();
    }

    cancel() {
        console.log('🛑 主动取消整个合成流水线');
        this.cancelled = true;
        this.activeTasks.forEach(tts => tts.abort());
        this.activeTasks = [];
        this.queue = [];
    }

    formatTTSValue(value, unit) {
        const sign = value >= 0 ? '+' : '';
        return `${sign}${value}${unit}`;
    }
}

// ==================== 音频播放队列 ====================
class AudioPlayQueue {
    constructor(sentenceCount) {
        this.audios = new Array(sentenceCount);
        this.durations = new Array(sentenceCount).fill(0);
        this.currentIndex = 0;
        this.isPlaying = false;
        this.onFinish = null;
        this.onSentenceStart = null;
        this.onSentenceEnd = null;

        this.waitTimeout = 15000;
        this.waitTimer = null;
    }

    pushAudio(index, blob) {
        if (index >= this.audios.length) {
            console.error(`❌ pushAudio 索引 ${index} 超出预分配长度 ${this.audios.length}`);
            return;
        }

        console.log(`📦 收到句子 ${index} 的音频数据，blob:`, blob ? `${blob.size} bytes` : 'null');
        if (blob === null) {
            this.audios[index] = null;
            this.durations[index] = 0;
            if (index === this.currentIndex && !this.isPlaying) {
                this.clearWaitTimer();
                this.playCurrent();
            }
            return;
        }

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.preload = 'auto';
        audio.volume = 0.8;

        audio.addEventListener('loadedmetadata', () => {
            this.durations[index] = audio.duration || 0;
            console.log(`📊 句子 ${index} 实际时长: ${audio.duration.toFixed(2)}秒`);
        });

        audio.addEventListener('error', (e) => {
            console.error(`🔇 音频元素错误:`, e);
            URL.revokeObjectURL(url);
            this.audios[index] = null;
            this.durations[index] = 0;
            if (index === this.currentIndex && !this.isPlaying) this.playCurrent();
        });

        this.audios[index] = audio;

        if (index === this.currentIndex && !this.isPlaying) {
            this.clearWaitTimer();
            this.playCurrent();
        }
    }

    playCurrent() {
        this.clearWaitTimer();

        if (this.currentIndex >= this.audios.length) {
            const allProcessed = this.audios.every(a => a !== undefined);
            if (allProcessed) {
                console.log('🏁 所有句子播放完毕');
                this.onFinish?.();
            } else {
                console.log(`⏳ 等待句子 ${this.currentIndex} 合成...`);
                this.setWaitTimer();
            }
            return;
        }

        const audio = this.audios[this.currentIndex];
        if (audio === null) {
            console.warn(`⏩ 句子 ${this.currentIndex} 合成失败，跳过`);
            this.currentIndex++;
            this.playCurrent();
            return;
        }
        if (!audio) {
            console.log(`⏳ 句子 ${this.currentIndex} 音频尚未就绪，等待...`);
            this.setWaitTimer();
            return;
        }

        this.isPlaying = true;
        console.log(`▶️ 开始播放句子 ${this.currentIndex}`);

        audio.onended = () => {
            URL.revokeObjectURL(audio.src);
            const duration = this.durations[this.currentIndex] || 0;
            console.log(`⏹️ 句子 ${this.currentIndex} 播放结束，时长: ${duration.toFixed(2)}秒`);
            this.onSentenceEnd?.(this.currentIndex, duration);

            this.isPlaying = false;
            this.currentIndex++;
            this.playCurrent();
        };

        audio.play().then(() => {
            this.onSentenceStart?.(this.currentIndex, audio);
        }).catch(e => {
            console.error(`🔇 播放句子 ${this.currentIndex} 失败:`, e);
            audio.onended?.();
        });
    }

    stop() {
        console.log('🛑 主动停止播放队列');
        this.clearWaitTimer();
        this.audios.forEach(a => {
            if (a instanceof Audio) {
                a.pause();
                URL.revokeObjectURL(a.src);
            }
        });
        this.audios = new Array(this.audios.length);
        this.durations.fill(0);
        this.currentIndex = 0;
        this.isPlaying = false;
    }

    setWaitTimer() {
        this.clearWaitTimer();
        this.waitTimer = setTimeout(() => {
            console.error(`⏰ 等待句子 ${this.currentIndex} 超时，强制结束播放`);
            this.audios[this.currentIndex] = null;
            this.durations[this.currentIndex] = 0;
            this.isPlaying = false;
            this.currentIndex++;
            this.playCurrent();
        }, this.waitTimeout);
    }

    clearWaitTimer() {
        if (this.waitTimer) {
            clearTimeout(this.waitTimer);
            this.waitTimer = null;
        }
    }
}

// ==================== DOM 文本节点索引（仅正文段落，完全匹配原版提取逻辑）====================
class DOMTextIndex {
    /**
     * 在 root 元素上构建纯净文本与文本节点的映射。
     * 严格跳过所有非正文元素：代码块、引用、脚注、按钮等，
     * 并且只遍历原版 extractTextFromMarkdown 中实际提取的段落标签（p, .ds-markdown-paragraph, h2, h3）。
     */
    static build(root) {
        const nodesInfo = [];
        let accumulatedText = '';

        // 需要跳过的选择器（与原版 useless 完全对齐，并增加代码块容器）
        const skipSelectors = `
            button,
            .md-code-block-banner,
            .md-code-block-banner-wrap,
            sup,
            sub,
            [data-footnote-ref],
            .ds-markdown-cite,
            pre,
            table,
            .ds-markdown-code-block,
            .md-code-block
        `;

        function walk(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.matches && node.matches(skipSelectors)) {
                    return;
                }
                node.childNodes.forEach(walk);
            }
            else if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                if (!text) return;
                const trimmed = text.replace(/\s+/g, ' ');
                if (!trimmed) return;
                nodesInfo.push({
                    node,
                    start: accumulatedText.length,
                    end: accumulatedText.length + trimmed.length,
                    text: trimmed
                });
                accumulatedText += trimmed;
            }
        }

        walk(root);

        return {
            fullText: accumulatedText,
            nodesInfo
        };
    }

    /**
     * 根据全局偏移范围，在 nodesInfo 中查找对应的节点区间，并高亮。
     * 返回第一个高亮 span，用于滚动。
     */
    static highlightRange(container, start, end, className = 'tts-highlight') {
        this.clearHighlights(container);
        const index = this.build(container);
        const nodesInfo = index.nodesInfo;
        if (nodesInfo.length === 0) return null;

        const intersecting = [];
        for (const info of nodesInfo) {
            if (info.end > start && info.start < end) {
                intersecting.push(info);
            }
            if (info.start >= end) break;
        }

        if (intersecting.length === 0) return null;

        let firstHighlightSpan = null;

        intersecting.forEach((info) => {
            const node = info.node;
            const nodeStart = info.start;
            const nodeEnd = info.end;
            const nodeText = node.textContent;

            const rangeStartInNode = Math.max(0, start - nodeStart);
            const rangeEndInNode = Math.min(nodeText.length, end - nodeStart);

            if (rangeStartInNode >= rangeEndInNode) return;

            const parent = node.parentNode;
            if (!parent) return;

            const before = nodeText.slice(0, rangeStartInNode);
            const highlight = nodeText.slice(rangeStartInNode, rangeEndInNode);
            const after = nodeText.slice(rangeEndInNode);

            const beforeNode = before ? document.createTextNode(before) : null;
            const highlightNode = document.createTextNode(highlight);
            const afterNode = after ? document.createTextNode(after) : null;

            const span = document.createElement('span');
            span.className = className;
            span.appendChild(highlightNode);

            if (firstHighlightSpan === null) firstHighlightSpan = span;

            if (beforeNode) parent.insertBefore(beforeNode, node);
            parent.insertBefore(span, beforeNode ? beforeNode.nextSibling : node);
            if (afterNode) parent.insertBefore(afterNode, span.nextSibling);
            parent.removeChild(node);
        });

        return firstHighlightSpan;
    }

    static clearHighlights(container) {
        const highlights = container.querySelectorAll('span.tts-highlight');
        highlights.forEach(span => {
            const parent = span.parentNode;
            const textNode = document.createTextNode(span.textContent);
            parent.replaceChild(textNode, span);
        });
    }
}

// ==================== 主类：FinalDeepSeekTTS ====================
class FinalDeepSeekTTS {
    // 匹配所有常见表情符号/特殊符号（与原版 extractTextFromMarkdown 完全一致）
    static EMOJI_REGEX = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

    constructor() {
        this.currentPlayingButton = null;
        this.isPlaying = false;
        this.currentAudio = null;
        this.processedMessages = new WeakSet();
        this.observer = null;
        this.themeObserver = null;
        this.currentTheme = 'light';
        this.userConfig = { voice: 'zh-CN-YunjianNeural', rate: 0, volume: 0, pitch: 0 };

        this.synthesisPipeline = null;
        this.audioPlayQueue = null;
        this.currentMessageContainer = null;
        this.currentSentenceRanges = [];

        this.init();
    }

    async init() {
        console.log('🎯 初始化纯前端DeepSeek TTS (精准高亮 + 跳过符号版)');
        await this.loadLocalSettings();
        this.currentVoice = { vcn: this.userConfig.voice };
        this.detectTheme();
        this.saveThemeToStorage();
        this.injectStyles();
        this.waitForDOM();
        this.setupPreciseObserver();
        this.setupMessageListener();
        this.initThemeObserver();

        if (typeof window.EdgeTTSBrowser === 'undefined') {
            console.error('❌ EdgeTTSBrowser 未加载！朗读功能不可用');
            showToast('EdgeTTS 库加载失败，请刷新页面或重装插件', 'error');
        } else {
            console.log('✅ EdgeTTSBrowser 已就绪');
        }
    }

    detectTheme() {
        const html = document.documentElement;
        const body = document.body;
        if (html.classList.contains('dark') ||
            body.classList.contains('dark') ||
            html.getAttribute('data-theme') === 'dark' ||
            body.getAttribute('data-theme') === 'dark') {
            this.currentTheme = 'dark';
        } else {
            this.currentTheme = 'light';
        }
        console.log(`🎨 检测到当前主题: ${this.currentTheme}`);
        return this.currentTheme;
    }

    saveThemeToStorage() {
        chrome.storage.local.set({ theme: this.currentTheme }).catch(() => {});
    }

    applyThemeToPanel(panel) {
        if (!panel) return;
        const bgColor = this.currentTheme === 'dark' ? '#3d3d3d' : '#c1c1c1';
        const textColor = this.currentTheme === 'dark' ? '#f0f0f0' : '#000000';
        panel.style.setProperty('background', bgColor, 'important');
        panel.style.setProperty('color', textColor, 'important');
        const badge = panel.querySelector('.tts-status-badge');
        if (badge) {
            badge.style.background = this.currentTheme === 'dark' ? '#555' : '#f5f5f5';
            badge.style.color = this.currentTheme === 'dark' ? '#eee' : '#666';
        }
    }

    applyThemeToAllPanels() {
        const panels = document.querySelectorAll('.deepseek-tts-panel');
        panels.forEach(panel => this.applyThemeToPanel(panel));
    }

    initThemeObserver() {
        if (this.themeObserver) this.themeObserver.disconnect();
        const targetNode = document.documentElement;
        const config = { attributes: true, subtree: false, childList: false, attributeFilter: ['class', 'data-theme'] };
        this.themeObserver = new MutationObserver(() => {
            const newTheme = this.detectTheme();
            if (newTheme !== this.currentTheme) {
                this.currentTheme = newTheme;
                this.saveThemeToStorage();
                this.applyThemeToAllPanels();
                console.log(`🔄 主题已切换为: ${this.currentTheme}`);
            }
        });
        this.themeObserver.observe(targetNode, config);
        if (document.body) {
            this.themeObserver.observe(document.body, config);
        }
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'settingsChanged') {
                this.userConfig = { ...this.userConfig, ...request.settings };
                this.currentVoice = { vcn: this.userConfig.voice };
                this.updateAllPanelsVoice(this.userConfig.voice);
                sendResponse({ success: true });
            }
            return true;
        });
    }

    updateAllPanelsVoice(voiceValue) {
        const panels = document.querySelectorAll('.deepseek-tts-panel');
        panels.forEach(panel => {
            const select = panel.querySelector('.tts-voice-select');
            if (select) select.value = voiceValue;
        });
    }

    injectStyles() {
        if (document.getElementById('deepseek-tts-styles')) return;
        const style = document.createElement('style');
        style.id = 'deepseek-tts-styles';
        style.textContent = `
            .deepseek-tts-panel {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 12px;
                border-radius: 20px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                margin-top: 8px;
                font-size: 12px;
                transition: background 0.2s, color 0.2s;
            }
            .deepseek-tts-panel.ai {
                border-left: 3px solid #4e6bf5;
            }
            .deepseek-tts-panel.user {
                border-left: 3px solid #ff9800;
            }
            .tts-voice-select {
                padding: 4px 8px;
                border-radius: 16px;
                border: 1px solid #ddd;
                background: white;
                font-size: 12px;
                cursor: pointer;
                color: black !important;
                background-color: white !important;
            }
            .tts-voice-select option {
                color: black !important;
                background-color: white !important;
            }
            .tts-play-button {
                display: inline-flex;
                align-items: center;
                padding: 4px 12px;
                background: #4e6bf5;
                color: white;
                border: none;
                border-radius: 16px;
                cursor: pointer;
                font-size: 12px;
                transition: background 0.2s;
            }
            .tts-play-button:hover {
                background: #3a56f4;
            }
            .tts-play-button.playing {
                background: #f44336;
            }
            .tts-status-badge {
                font-size: 10px;
                color: #666;
                background: #f5f5f5;
                padding: 2px 8px;
                border-radius: 12px;
                transition: background 0.2s, color 0.2s;
            }
            span.tts-highlight {
                background-color: #ffeb3b !important;
                color: #000 !important;
                border-radius: 4px;
                padding: 2px 0;
                transition: background 0.2s;
            }
            body.dark span.tts-highlight {
                background-color: #b7930e !important;
                color: #fff !important;
            }
        `;
        document.head.appendChild(style);
    }

    waitForDOM() {
        if (document.body) {
            setTimeout(() => this.scanAllMessages(), 1500);
        } else {
            setTimeout(() => this.waitForDOM(), 100);
        }
    }

    setupPreciseObserver() {
        if (this.observer) this.observer.disconnect();
        this.observer = new MutationObserver((mutations) => {
            let needScan = false;
            for (const mut of mutations) {
                if (mut.type === 'childList' && mut.addedNodes.length) {
                    needScan = true;
                    break;
                }
            }
            if (needScan) {
                if (this.scanTimer) clearTimeout(this.scanTimer);
                this.scanTimer = setTimeout(() => {
                    this.scanAllMessages();
                    this.scanTimer = null;
                }, 500);
            }
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
    }

    scanAllMessages() {
        this.scanUserMessages();
        this.scanAIMessages();
    }

    scanUserMessages() {
        const userContainers = document.querySelectorAll('._9663006');
        userContainers.forEach((container) => {
            if (this.processedMessages.has(container)) return;
            const msgDiv = container.querySelector('.d29f3d7d.ds-message .fbb737a4');
            if (!msgDiv) return;
            this.injectUserPanel(container, msgDiv);
            this.processedMessages.add(container);
        });
    }

    injectUserPanel(container, messageContainer) {
        if (container.querySelector('.deepseek-tts-panel')) return;
        const panel = this.createPanel(messageContainer, 'user');
        const actionsDiv = container.querySelector('._11d6b3a');
        if (actionsDiv) {
            actionsDiv.insertAdjacentElement('beforebegin', panel);
        } else {
            container.appendChild(panel);
        }
    }

    scanAIMessages() {
        const aiContainers = document.querySelectorAll('._4f9bf79');
        aiContainers.forEach((container) => {
            if (this.processedMessages.has(container)) return;
            const messageDiv = container.querySelector('.ds-message._63c77b1');
            if (!messageDiv) return;
            const markdownDiv = messageDiv.querySelector(':scope > .ds-markdown');
            if (!markdownDiv) return;
            this.injectAIPanel(container, markdownDiv);
            this.processedMessages.add(container);
        });
    }

    injectAIPanel(container, messageContainer) {
        if (container.querySelector('.deepseek-tts-panel')) return;
        const panel = this.createPanel(messageContainer, 'ai');
        const actionsDiv = container.querySelector('.ds-flex._0a3d93b');
        if (actionsDiv) {
            actionsDiv.insertAdjacentElement('beforebegin', panel);
        } else {
            container.appendChild(panel);
        }
    }

    // ========== 修改后的 createPanel 方法（已移除字数统计） ==========
    createPanel(messageContainer, type) {
        const panel = document.createElement('div');
        panel.className = `deepseek-tts-panel ${type}`;
        panel.messageContainer = messageContainer;

        // 原 wordCount 变量已移除，不再显示字数

        const voiceSelect = document.createElement('select');
        voiceSelect.className = 'tts-voice-select';
        voiceSelect.innerHTML = `
            <option value="zh-CN-XiaoxiaoNeural">晓晓</option>
            <option value="zh-CN-XiaoyiNeural">晓伊</option>
            <option value="zh-CN-YunjianNeural">云剑</option>
            <option value="zh-CN-YunxiNeural">云希</option>
            <option value="zh-CN-YunxiaNeural">云霞</option>
            <option value="zh-CN-YunyangNeural">云扬</option>
        `;
        voiceSelect.value = this.userConfig.voice || 'zh-CN-YunjianNeural';

        const playBtn = document.createElement('button');
        playBtn.className = 'tts-play-button';
        playBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" style="margin-right: 6px;">
                <path d="M5 3v14l11-7z"/>
            </svg>
            <span>朗读</span>   <!-- 不再显示字数 -->
        `;

        const badge = document.createElement('span');
        badge.className = 'tts-status-badge';
        badge.textContent = type === 'user' ? '用户提问' : 'AI回答';

        panel.appendChild(voiceSelect);
        panel.appendChild(playBtn);
        panel.appendChild(badge);

        this.applyThemeToPanel(panel);
        this.bindPlayEvent(panel, playBtn, voiceSelect);

        voiceSelect.addEventListener('change', () => {
            const newVoice = voiceSelect.value;
            this.userConfig.voice = newVoice;
            this.currentVoice = { vcn: newVoice };
            chrome.storage.local.set({ voice: newVoice });
            this.updateAllPanelsVoice(newVoice);
            chrome.runtime.sendMessage({ action: 'voiceChanged', voice: newVoice });
        });

        return panel;
    }

    bindPlayEvent(panel, playBtn, voiceSelect) {
        playBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            console.log('🖱️ 朗读按钮点击');
            if (playBtn.classList.contains('playing')) {
                console.log('⏹️ 点击停止播放');
                this.stopPlayback(playBtn);
                return;
            }
            await this.startPlayback(playBtn, panel.messageContainer, voiceSelect.value);
        });
    }

    // -------------------- 核心修改：朗读时跳过特殊符号，高亮精准对应 --------------------
    async startPlayback(button, messageContainer, voice) {
        console.log('🚀 startPlayback 被调用，消息容器:', messageContainer);

        if (typeof window.EdgeTTSBrowser === 'undefined') {
            console.error('❌ EdgeTTSBrowser 不可用，无法朗读');
            showToast('EdgeTTS 库未加载，请刷新页面', 'error');
            return;
        }

        this.stopPlayback(this.currentPlayingButton);

        // 1. 构建原始纯净文本索引（包含表情符号，用于高亮定位）
        const index = DOMTextIndex.build(messageContainer);
        const rawFullText = index.fullText;
        console.log(`📝 原始正文长度: ${rawFullText.length}, 预览: "${rawFullText.slice(0, 50)}..."`);

        if (!rawFullText || rawFullText.length === 0) {
            console.error('❌ 未提取到有效正文');
            this.resetButton(button);
            showToast('此消息无可朗读的正文', 'error');
            return;
        }

        // 2. 移除所有表情符号/特殊符号，生成纯净朗读文本，同时建立字符映射表
        const emojiRegex = FinalDeepSeekTTS.EMOJI_REGEX;
        let cleanFullText = '';
        const offsetMap = []; // 长度 = cleanFullText.length，存储每个字符在 rawFullText 中的索引
        for (let i = 0; i < rawFullText.length; i++) {
            const ch = rawFullText[i];
            if (!emojiRegex.test(ch)) {
                cleanFullText += ch;
                offsetMap.push(i);
            }
        }
        console.log(`🧹 移除特殊符号后正文长度: ${cleanFullText.length}`);

        if (!cleanFullText || cleanFullText.length === 0) {
            console.error('❌ 移除符号后无有效文本');
            this.resetButton(button);
            showToast('此消息无可朗读的正文（仅含特殊符号）', 'error');
            return;
        }

        // 3. 基于纯净文本分割句子
        const cleanSentences = SentenceSplitter.split(cleanFullText);
        console.log(`📝 分割后句子数量: ${cleanSentences.length}`);

        // 4. 计算每个纯净句子在原始全文中的偏移范围（用于高亮）
        const sentenceRanges = [];
        let cleanPos = 0;
        for (const sentence of cleanSentences) {
            const startClean = cleanFullText.indexOf(sentence, cleanPos);
            if (startClean === -1) {
                // 容错：不应该发生，若发生则跳过
                cleanPos += sentence.length;
                continue;
            }
            const endClean = startClean + sentence.length;
            // 通过 offsetMap 转换为 rawFullText 中的偏移
            const startRaw = offsetMap[startClean];
            const endRaw = offsetMap[endClean - 1] + 1; // 最后一个保留字符的索引+1
            sentenceRanges.push({ start: startRaw, end: endRaw });
            cleanPos = endClean;
        }
        this.currentSentenceRanges = sentenceRanges;

        // 5. 更新按钮状态
        this.currentPlayingButton = button;
        button.classList.add('playing');
        button.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" style="margin-right: 6px;">
                <rect x="6" y="3" width="3" height="14"/><rect x="11" y="3" width="3" height="14"/>
            </svg><span>停止</span>
        `;

        this.currentMessageContainer = messageContainer;

        // 6. 初始化播放队列（使用句子数量）
        this.audioPlayQueue = new AudioPlayQueue(cleanSentences.length);

        // 7. 句子开始回调：高亮原始文本中的对应范围
        this.audioPlayQueue.onSentenceStart = (index) => {
            if (index >= sentenceRanges.length) return;
            const { start, end } = sentenceRanges[index];
            console.log(`🔆 高亮句子 ${index}: 原始偏移 [${start}, ${end})`);
            const highlightSpan = DOMTextIndex.highlightRange(
                messageContainer,
                start,
                end,
                'tts-highlight'
            );
            if (highlightSpan) {
                highlightSpan.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest'
                });
            }
        };

        // 8. 播放结束回调
        this.audioPlayQueue.onFinish = () => {
            console.log('🏁 全部播放结束');
            this.resetButton(button);
            DOMTextIndex.clearHighlights(messageContainer);
            this.synthesisPipeline?.cancel();
            this.audioPlayQueue = null;
            this.synthesisPipeline = null;
            this.currentMessageContainer = null;
            this.currentSentenceRanges = [];
        };

        // 9. 初始化合成流水线（使用纯净句子文本）
        this.synthesisPipeline = new SynthesisPipeline();
        this.synthesisPipeline.onAudioReady = (index, blob) => {
            this.audioPlayQueue?.pushAudio(index, blob);
        };

        cleanSentences.forEach((sentence, idx) => {
            this.synthesisPipeline.addSentence(idx, sentence, voice, {
                rate: this.userConfig.rate,
                volume: this.userConfig.volume,
                pitch: this.userConfig.pitch
            });
        });

        // 10. 开始播放
        this.audioPlayQueue.playCurrent();
    }

    stopPlayback(button) {
        console.log('⏹️ stopPlayback 被调用');
        if (this.synthesisPipeline) {
            this.synthesisPipeline.cancel();
            this.synthesisPipeline = null;
        }
        if (this.audioPlayQueue) {
            this.audioPlayQueue.stop();
            this.audioPlayQueue = null;
        }
        this.stopPlaying();

        if (this.currentMessageContainer) {
            DOMTextIndex.clearHighlights(this.currentMessageContainer);
            this.currentMessageContainer = null;
        }
        this.currentSentenceRanges = [];

        this.resetButton(button);
        this.currentPlayingButton = null;
    }

    stopPlaying() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.isPlaying = false;
            this.currentAudio = null;
        }
    }

    resetButton(button) {
        if (!button) return;
        button.classList.remove('playing');
        const panel = button.closest('.deepseek-tts-panel');
        // 不再需要 wordCount 变量，直接设置为固定文本
        button.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" style="margin-right: 6px;">
                <path d="M5 3v14l11-7z"/>
            </svg>
            <span>朗读</span>
        `;
        if (button === this.currentPlayingButton) this.currentPlayingButton = null;
    }

    async loadLocalSettings() {
        return new Promise(resolve => {
            chrome.storage.local.get(['voice', 'rate', 'volume', 'pitch'], (result) => {
                this.userConfig = {
                    voice: result.voice || 'zh-CN-YunjianNeural',
                    rate: result.rate || 0,
                    volume: result.volume || 0,
                    pitch: result.pitch || 0
                };
                this.currentVoice = { vcn: this.userConfig.voice };
                console.log('⚙️ 加载用户设置:', this.userConfig);
                resolve();
            });
        });
    }
}

// ==================== 启动 ====================
let finalTTS;
function initFinalTTS() {
    if (!finalTTS) finalTTS = new FinalDeepSeekTTS();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFinalTTS);
} else {
    initFinalTTS();
}
window.addEventListener('load', () => {
    setTimeout(() => finalTTS?.scanAllMessages(), 2000);
});

window.addEventListener('error', (e) => {
    console.error('🌐 全局错误:', e.error || e.message);
});