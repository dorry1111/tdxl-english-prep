/**
 * 404 页面。
 */
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ROUTES } from '@/constants';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-4">
      <Card title="页面不存在">
        <EmptyState
          icon="alert"
          title="没有这个页面"
          description="链接可能已经失效，回到「学习」继续吧。"
          action={<Button onClick={() => navigate(ROUTES.home)}>回到学习</Button>}
        />
      </Card>
    </div>
  );
}
