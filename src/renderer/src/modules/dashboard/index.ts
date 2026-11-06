import { LayoutGrid } from 'lucide-react';
import { defineModule } from '@/app/module';

export default defineModule({
  id: 'dashboard',
  path: '',
  title: 'Dashboard',
  group: 'Overview',
  icon: LayoutGrid,
  lede: 'Where your game stands, drawn only from what you have recorded.',
  load: () => import('./DashboardPage'),
});
