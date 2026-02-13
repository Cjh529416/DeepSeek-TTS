// background.js - 纯前端版（仅负责注入和存储初始化）
chrome.runtime.onInstalled.addListener(() => {
  console.log('DeepSeek TTS朗读器 (纯前端版) 已安装');
  chrome.storage.local.set({
    voice: 'zh-CN-YunjianNeural',
    rate: 0,
    volume: 0,
    pitch: 0,
    autoRead: false
  });
});
