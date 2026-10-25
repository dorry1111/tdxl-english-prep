/**
 * dayjs 统一配置（单例）。
 *
 * 为什么单独一个文件：`dayjs(str, 'YYYY-MM-DD', true)` 的严格解析依赖
 * `customParseFormat` 插件，插件是全局注册的。集中在这里注册一次，
 * 其他模块只需 `import { dayjs } from '@/lib/dayjs'`，不会因为忘记 extend
 * 而退化成 `new Date()` 的宽松解析（那在 Safari 上会按 UTC 解析、差 8 小时）。
 */
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

export { dayjs };
