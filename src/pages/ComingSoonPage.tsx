/**
 * 通用「施工中」占位页。
 *
 * 批次 1 只实现四个一级页面的真实空壳，其余 20+ 个页面在各自批次实现。
 * 为了让路由结构现在就完整（刷新不 404、导航可跳转），
 * 这些页面统一渲染本组件，并通过 props 说明「将来放什么」。
 *
 * 为什么不建 20 个空文件：每个文件只有一行 JSX，除了增加噪音没有收益；
 * 真正实现时按架构的目录结构逐个替换即可。
 */
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PLACEHOLDER } from '@/constants';

export interface ComingSoonPageProps {
  /** 页面名称 */
  title: string;
  /** 将来放什么内容 */
  description: string;
}

export default function ComingSoonPage({ title, description }: ComingSoonPageProps) {
  return (
    <div className="flex flex-col gap-4">
      <Card title={title}>
        <EmptyState icon="sparkle" title={PLACEHOLDER.building} description={description} />
      </Card>
    </div>
  );
}
