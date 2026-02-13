// popup.js - 纯前端版 + 主题同步
document.addEventListener('DOMContentLoaded', async () => {
    const voiceSelect = document.getElementById('voiceSelect');
    const rateSlider = document.getElementById('rate');
    const volumeSlider = document.getElementById('volume');
    const pitchSlider = document.getElementById('pitch');
    const rateValue = document.getElementById('rateValue');
    const volumeValue = document.getElementById('volumeValue');
    const pitchValue = document.getElementById('pitchValue');
    const testVoiceBtn = document.getElementById('testVoice');
    const readCurrentBtn = document.getElementById('readCurrent');
    const toggleAutoBtn = document.getElementById('toggleAutoBtn');

    let currentSettings = {
        voice: 'zh-CN-YunjianNeural',
        rate: 0,
        volume: 0,
        pitch: 0
    };
    let autoRead = false;

    // ========== 主题同步 ==========
    async function applyPopupTheme() {
        try {
            const storage = await chrome.storage.local.get(['theme']);
            const theme = storage.theme || 'light';  // 默认浅色
            const body = document.body;
            const bgColor = theme === 'dark' ? '#3d3d3d' : '#c1c1c1';
            const textColor = theme === 'dark' ? '#f0f0f0' : '#000000';
            const subTextColor = theme === 'dark' ? '#ccc' : '#666';
            
            body.style.background = bgColor;
            body.style.color = textColor;
            
            // 修改提示文字颜色
            const tipDiv = document.querySelector('div[style*="font-size: 10px;"]');
            if (tipDiv) tipDiv.style.color = subTextColor;
            
            // 添加 dark 类以便CSS选择器使用
            if (theme === 'dark') {
                body.classList.add('dark');
            } else {
                body.classList.remove('dark');
            }
        } catch (e) {
            console.warn('读取主题失败，使用浅色主题', e);
        }
    }

    // 加载存储的设置
    await loadSettingsFromStorage();
    await applyPopupTheme();  // 应用主题
    
    // 初始化滑块值
    rateSlider.value = currentSettings.rate;
    volumeSlider.value = currentSettings.volume;
    pitchSlider.value = currentSettings.pitch;
    updateSliderValues();

    // 硬编码中文音色
    const voices = [
        { name: 'zh-CN-XiaoxiaoNeural', display_name: '晓晓' },
        { name: 'zh-CN-XiaoyiNeural', display_name: '晓伊' },
        { name: 'zh-CN-YunjianNeural', display_name: '云剑' },
        { name: 'zh-CN-YunxiNeural', display_name: '云希' },
        { name: 'zh-CN-YunxiaNeural', display_name: '云霞' },
        { name: 'zh-CN-YunyangNeural', display_name: '云扬' }
    ];

    voiceSelect.innerHTML = '';
    voices.forEach(v => {
        const option = document.createElement('option');
        option.value = v.name;
        option.textContent = v.display_name;
        voiceSelect.appendChild(option);
    });
    voiceSelect.value = currentSettings.voice;

    // ---------- 事件绑定 ----------
    voiceSelect.addEventListener('change', () => {
        currentSettings.voice = voiceSelect.value;
        saveSettingsToStorage();
        notifyContentScriptSettingsChanged();
    });

    rateSlider.addEventListener('input', () => {
        currentSettings.rate = parseInt(rateSlider.value);
        updateSliderValues();
        saveSettingsToStorage();
        notifyContentScriptSettingsChanged();
    });

    volumeSlider.addEventListener('input', () => {
        currentSettings.volume = parseInt(volumeSlider.value);
        updateSliderValues();
        saveSettingsToStorage();
        notifyContentScriptSettingsChanged();
    });

    pitchSlider.addEventListener('input', () => {
        currentSettings.pitch = parseInt(pitchSlider.value);
        updateSliderValues();
        saveSettingsToStorage();
        notifyContentScriptSettingsChanged();
    });

    testVoiceBtn.addEventListener('click', testVoice);
    readCurrentBtn.addEventListener('click', readCurrentAnswer);
    toggleAutoBtn.addEventListener('click', toggleAutoRead);

    // 监听来自 content script 的音色变更通知
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === 'voiceChanged') {
            voiceSelect.value = request.voice;
            currentSettings.voice = request.voice;
            chrome.storage.local.set({ voice: request.voice });
        }
    });

    // ---------- 辅助函数 ----------
    function updateSliderValues() {
        rateValue.textContent = `${currentSettings.rate}%`;
        volumeValue.textContent = `${currentSettings.volume}%`;
        pitchValue.textContent = `${currentSettings.pitch}Hz`;
    }

    function formatTTSValue(value, unit) {
        const sign = value >= 0 ? '+' : '';
        return `${sign}${value}${unit}`;
    }

    async function testVoice() {
        const testText = '你好，我是DeepSeek智能助手，很高兴为您服务。';
        try {
            const tts = new EdgeTTSBrowser(testText, currentSettings.voice);
            tts.rate = formatTTSValue(currentSettings.rate, '%');
            tts.volume = formatTTSValue(currentSettings.volume, '%');
            tts.pitch = formatTTSValue(currentSettings.pitch, 'Hz');
            
            const result = await tts.synthesize();
            const url = URL.createObjectURL(result.audio);
            const audio = new Audio(url);
            await audio.play();
            showNotificationMessage('测试语音播放中', 'success');
        } catch (e) {
            console.error('测试语音失败:', e);
            showNotificationMessage(`测试失败: ${e.message}`, 'error');
        }
    }

    async function readCurrentAnswer() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) {
                showNotificationMessage('请先打开DeepSeek页面', 'error');
                return;
            }
            chrome.tabs.sendMessage(tabs[0].id, { 
                action: 'readCurrent',
                settings: currentSettings
            }, (response) => {
                if (chrome.runtime.lastError) {
                    showNotificationMessage('请在DeepSeek页面使用此功能', 'error');
                }
            });
        });
    }

    function toggleAutoRead() {
        autoRead = !autoRead;
        toggleAutoBtn.textContent = `自动朗读: ${autoRead ? '开' : '关'}`;
        toggleAutoBtn.style.background = autoRead ? '#2e7d32' : '#4e6bf5';
        chrome.storage.local.set({ autoRead: autoRead });
        
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) return;
            chrome.tabs.sendMessage(tabs[0].id, { 
                action: 'toggleAutoRead', 
                enabled: autoRead 
            });
        });
    }

    async function loadSettingsFromStorage() {
        const settings = await chrome.storage.local.get(['voice', 'rate', 'volume', 'pitch', 'autoRead']);
        currentSettings = {
            voice: settings.voice || 'zh-CN-YunjianNeural',
            rate: settings.rate || 0,
            volume: settings.volume || 0,
            pitch: settings.pitch || 0
        };
        autoRead = settings.autoRead || false;
        toggleAutoBtn.textContent = `自动朗读: ${autoRead ? '开' : '关'}`;
        toggleAutoBtn.style.background = autoRead ? '#2e7d32' : '#4e6bf5';
    }

    async function saveSettingsToStorage() {
        await chrome.storage.local.set(currentSettings);
    }

    function notifyContentScriptSettingsChanged() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) return;
            chrome.tabs.sendMessage(tabs[0].id, { 
                action: 'settingsChanged',
                settings: currentSettings
            }).catch(() => {});
        });
    }

    function showNotificationMessage(message, type = 'info') {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'success' ? '#4CAF50' : '#f44336'};
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            z-index: 10000;
            font-size: 12px;
            animation: fadeInOut 3s;
        `;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }

    // 添加CSS动画
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeInOut {
            0% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
            10% { opacity: 1; transform: translateX(-50%) translateY(0); }
            90% { opacity: 1; transform: translateX(-50%) translateY(0); }
            100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
        }
    `;
    document.head.appendChild(style);
});