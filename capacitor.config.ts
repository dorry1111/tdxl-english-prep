import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dorry.tdxl',
  appName: '同等学力英语备考',
  webDir: 'dist',
  plugins: {
    // 原生平台用 CapacitorHttp 走 NSURLSession/okHttp，绕过 WKWebView 的 CORS 限制
    // （WebDAV 同步与大模型 API 调用在 iOS 上都因此免于跨域拦截）
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
