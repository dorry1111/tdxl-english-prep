/**
 * 在线/离线状态。
 *
 * 只用 `navigator.onLine` + online/offline 事件：
 * 它反映的是「网络接口是否可用」，不是「能不能访问到服务器」。
 * 对同步模块来说这个粒度够用——真正的失败由 fetch 的异常来表达。
 */
import { useEffect, useState } from 'react';

/** 返回当前是否在线 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') {
      return true;
    }
    return navigator.onLine;
  });

  useEffect(() => {
    const handleOnline = (): void => setIsOnline(true);
    const handleOffline = (): void => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    // 兜底对齐一次（部分浏览器 onLine 初值不准）
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
